"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { humanize } from "@/lib/constants";
import { saveWorkOrder, setWorkOrderStatus } from "@/app/actions/fleet";

/*
 * Maintenance wrappers around the shared work-order actions in src/app/actions/fleet.ts. They check the work order
 * as it is now, not as the page saw it, before anything touches the unit:
 *  - a button only moves a job on from the status it was drawn for, so a stale page cannot restart or reopen a job;
 *  - a job in the shop leaves it only by Complete or Cancel, which release the unit: the form cannot move it back to
 *    open or draft, cancel it, or swap its unit (any of those would leave the unit in the shop with no open job).
 * Refusals come back as ActionState because a thrown error's message is hidden in production builds.
 */

/** What each button may do, keyed by the status the work order must still have. */
const BUTTON_MOVES: Record<string, readonly string[]> = {
  DRAFT: ["IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DONE", "CANCELLED"],
};

function refresh(id: string) {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  revalidatePath(`/maintenance/work-orders/${id}`);
}

/** Start / Complete / Cancel buttons. */
export async function moveWorkOrder(id: string, to: string): Promise<ActionState> {
  await requireUser("fleet.edit");
  return attempt(async () => {
    const wo = await db.workOrder.findUnique({ where: { id }, select: { number: true, status: true } });
    if (!wo) throw new FormError("This work order no longer exists. Refresh the page.");
    if (!BUTTON_MOVES[wo.status]?.includes(to)) {
      // The page is stale: show the work order as it is now instead of moving it again.
      refresh(id);
      throw new FormError(`Work order #${wo.number} is already ${humanize(wo.status).toLowerCase()}.`);
    }
    try {
      await setWorkOrderStatus(id, to);
    } catch (e) {
      // A refusal from the shared action (FormError) is shown on the button; the page redraws as it is now.
      if (e instanceof FormError) refresh(id);
      throw e;
    }
    return { ok: `Work order #${wo.number} is now ${humanize(to).toLowerCase()}` };
  });
}

/** The work order form (new and edit). Saving redirects to the work order, as the shared action does. */
export async function saveWorkOrderChecked(workOrderId: string | null, prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser("fleet.edit");
  const refused = await attempt(async () => {
    if (!workOrderId) return;
    const f = fields(fd);
    const status = f.str("status") ?? "OPEN";
    // Same normalisation as saveWorkOrder: a truck wins over a trailer.
    const truckId = f.str("truckId");
    const unit = { truckId: truckId ?? null, trailerId: truckId ? null : f.str("trailerId") };
    const saved = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { number: true, status: true, truckId: true, trailerId: true } });
    if (!saved) throw new FormError("This work order no longer exists.");
    const seen = f.str("savedStatus");
    if (seen && seen !== saved.status) {
      throw new FormError(`Work order #${saved.number} changed while this page was open: it is ${humanize(saved.status).toLowerCase()} now. Reload the page before saving.`);
    }
    if (saved.status === "IN_PROGRESS") {
      if (status !== "IN_PROGRESS" && status !== "DONE") {
        throw new FormError(`Work order #${saved.number} is in the shop. Complete it here, or cancel it with its Cancel button, which releases the unit.`);
      }
      const sameUnit = saved.truckId ? unit.truckId === saved.truckId : !unit.truckId && unit.trailerId === saved.trailerId;
      if (!sameUnit) {
        throw new FormError(`Work order #${saved.number} is in the shop on its unit. Complete or cancel it before moving the work to another unit.`);
      }
    }
  });
  if (refused?.error) return refused;
  return saveWorkOrder(workOrderId, prev, fd);
}
