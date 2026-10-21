"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { BOARD_STATUS_LABELS, type BoardStatus } from "@/lib/constants";
import { arriveAtStop, clearDriverBoardOverride, completeStop, setDriverBoardStatus, transitionLoad } from "@/lib/workflow";
import { isDispatchHeld } from "@/app/(app)/driver/shared";

/** Drivers can only move their own loads forward: ASSIGNED → IN_TRANSIT → DELIVERED. */
export async function driverUpdateLoad(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("driver.portal");
  return attempt(async () => {
    const load = await db.load.findUniqueOrThrow({ where: { id: loadId } });
    if (!me.driver || load.driverId !== me.driver.id) throw new FormError("This load isn't assigned to you");
    const f = fields(fd);
    const to = f.req("status");
    if (!["IN_TRANSIT", "DELIVERED"].includes(to)) throw new FormError("Drivers can only start or complete loads");
    if (to === "DELIVERED" && !f.str("podSignedBy")) throw new FormError("Enter who signed the proof of delivery");
    await transitionLoad(loadId, to as "IN_TRANSIT" | "DELIVERED", me.id, {
      podSignedBy: f.str("podSignedBy"), lat: f.num("lat") ?? undefined, lng: f.num("lng") ?? undefined,
    });
    revalidatePath("/driver");
    return { ok: to === "IN_TRANSIT" ? "Trip started — drive safe" : "Delivery confirmed. Great job" };
  });
}

/**
 * Arrived / loaded / unloaded at a stop. Completing the last delivery stop does not deliver the load — the POD form does.
 * Returns business errors as ActionState: thrown messages are redacted in production builds.
 */
export async function driverStopAction(loadId: string, stopId: string, action: "arrive" | "complete", pos?: { lat?: number; lng?: number }): Promise<ActionState> {
  const me = await requireUser("driver.portal");
  return attempt(async () => {
    const load = await db.load.findUnique({ where: { id: loadId }, select: { driverId: true, status: true } });
    if (!load || !me.driver || load.driverId !== me.driver.id) throw new FormError("This load isn't assigned to you");
    if (load.status !== "IN_TRANSIT") throw new FormError("This trip is no longer in transit — the page now shows its current status");
    const stop = await db.stop.findUnique({ where: { id: stopId }, select: { loadId: true } });
    if (!stop || stop.loadId !== loadId) throw new FormError("Dispatch has changed the stops on this trip — check the updated list");
    if (action === "arrive") await arriveAtStop(loadId, stopId, me.id, pos);
    else await completeStop(loadId, stopId, me.id, pos);
    revalidatePath("/driver");
    return { ok: action === "arrive" ? "Arrived" : "Stop completed" };
  });
}

/**
 * Driver sets their own availability when not on a trip: READY (back to automatic), REST, HOME. Only dispatch can lift
 * a stop or a vacation, so changing away from one is refused here instead of silently clearing the override.
 */
export async function setDriverStatus(status: string): Promise<ActionState> {
  const me = await requireUser("driver.portal");
  return attempt(async () => {
    if (!me.driver) throw new FormError("Your login is not linked to a driver profile — ask the office to link it");
    if (!["READY", "REST", "HOME"].includes(status)) throw new FormError("Pick Ready, Rest or Home");
    const driver = await db.driver.findUniqueOrThrow({ where: { id: me.driver.id }, select: { boardStatus: true } });
    if (isDispatchHeld(driver.boardStatus)) {
      const label = BOARD_STATUS_LABELS[driver.boardStatus as BoardStatus] ?? driver.boardStatus;
      throw new FormError(`Dispatch has set your status to ${label}. Ask your dispatcher to change it.`);
    }
    const onTrip = await db.load.count({ where: { driverId: me.driver.id, status: "IN_TRANSIT" } });
    if (onTrip) throw new FormError("Your status follows the trip while you are driving — it changes as you complete stops.");
    if (status === "READY") await clearDriverBoardOverride(me.driver.id, me.id);
    else await setDriverBoardStatus(me.driver.id, status as "REST" | "HOME", me.id, "set by driver");
    revalidatePath("/driver");
    revalidatePath("/dispatch");
    return { ok: `Status set to ${BOARD_STATUS_LABELS[status as BoardStatus]}` };
  });
}
