"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { CITIES, LOAD_STATUSES, type LoadStatus } from "@/lib/constants";
import { routeKm } from "@/lib/geo";
import { notifyLoadAssigned, notifyLoadIssue } from "@/lib/notify";
import { arriveAtStop, assertAvailable, completeStop, nextLoadReference, routeSummaryFromStops, syncDriverBoardStatus, transitionLoad } from "@/lib/workflow";

type StopInput = { seq: number; type: string; name: string; address: string | null; city: string; lat: number; lng: number; windowStart: Date | null; windowEnd: Date | null; notes: string | null };

/**
 * Stops arrive as parallel arrays (stopType[], stopCity[], …) from the load form.
 * Backwards compatible with the simple originCity / destCity form.
 */
function parseStops(fd: FormData, f: ReturnType<typeof fields>): StopInput[] {
  const types = fd.getAll("stopType").map(String);
  if (types.length === 0) {
    const place = (prefix: "origin" | "dest", type: string, seq: number): StopInput => {
      const cityName = f.req(`${prefix}City`, prefix === "origin" ? "Pickup city" : "Delivery city");
      const known = CITIES.find((c) => c.name.toLowerCase() === cityName.toLowerCase());
      const lat = f.num(`${prefix}Lat`) ?? known?.lat;
      const lng = f.num(`${prefix}Lng`) ?? known?.lng;
      if (lat == null || lng == null) throw new FormError(`Unknown city "${cityName}" — pick from the list or enter coordinates`);
      const when = f.date(prefix === "origin" ? "pickupAt" : "deliveryAt");
      return { seq, type, name: f.str(`${prefix}Name`) ?? known?.name ?? cityName, address: null, city: known?.name ?? cityName, lat, lng,
        windowStart: type === "PICKUP" ? when : null, windowEnd: type === "DELIVERY" ? when : null, notes: null };
    };
    return [place("origin", "PICKUP", 1), place("dest", "DELIVERY", 2)];
  }
  const get = (k: string) => fd.getAll(k).map((v) => (typeof v === "string" ? v.trim() : ""));
  const names = get("stopName"), cities = get("stopCity"), lats = get("stopLat"), lngs = get("stopLng"), starts = get("stopWindowStart"), ends = get("stopWindowEnd"), addrs = get("stopAddress"), notes = get("stopNotes");
  const stops = types.map((type, i): StopInput => {
    if (type !== "PICKUP" && type !== "DELIVERY") throw new FormError("Each stop must be a pickup or a delivery");
    const cityName = cities[i];
    if (!cityName) throw new FormError(`Stop ${i + 1}: city is required`);
    const known = CITIES.find((c) => c.name.toLowerCase() === cityName.toLowerCase());
    const lat = lats[i] ? Number(lats[i]) : known?.lat;
    const lng = lngs[i] ? Number(lngs[i]) : known?.lng;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) throw new FormError(`Stop ${i + 1}: unknown city "${cityName}"`);
    const ws = starts[i] ? new Date(starts[i]) : null;
    const we = ends[i] ? new Date(ends[i]) : null;
    if ((ws && Number.isNaN(ws.getTime())) || (we && Number.isNaN(we.getTime()))) throw new FormError(`Stop ${i + 1}: invalid time`);
    return { seq: i + 1, type, name: names[i] || known?.name || cityName, address: addrs[i] || null, city: known?.name ?? cityName, lat, lng, windowStart: ws, windowEnd: we, notes: notes[i] || null };
  });
  if (!stops.some((s) => s.type === "PICKUP") || !stops.some((s) => s.type === "DELIVERY")) throw new FormError("A load needs at least one pickup and one delivery");
  return stops;
}

export async function saveLoad(loadId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  let id = loadId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const stops = parseStops(fd, f);
    const summary = routeSummaryFromStops(stops.map((s) => ({ ...s })));
    if (summary.deliveryAt <= summary.pickupAt) throw new FormError("Delivery must be after pickup");

    const existing = loadId ? await db.load.findUniqueOrThrow({ where: { id: loadId } }) : null;
    if (existing?.status === "INVOICED") throw new FormError("This load is invoiced. Change the invoice instead.");
    // Units are fixed once a load is under way; Recover moves it to another unit.
    const locked = existing ? !["PLANNED", "ASSIGNED"].includes(existing.status) : false;
    const truckId = f.str("truckId");
    const driverId = f.str("driverId");
    const trailerId = locked ? existing!.trailerId : f.str("trailerId");
    if (locked && (truckId !== existing!.truckId || driverId !== existing!.driverId)) throw new FormError("Use “Recover” to move an in-progress load to another unit");
    if (!locked) {
      // Only units that change are checked: an unchanged driver who went on hold must not block a rate or note edit.
      const changed = (next: string | null, prev: string | null | undefined) => (next && next !== prev ? next : null);
      await assertAvailable(loadId, {
        truckId: changed(truckId, existing?.truckId),
        driverId: changed(driverId, existing?.driverId),
        trailerId: changed(trailerId, existing?.trailerId),
      }, { start: summary.pickupAt, end: summary.deliveryAt });
    }

    const distanceKm = f.num("distanceKm") ?? routeKm(stops);
    const driver = driverId ? await db.driver.findUnique({ where: { id: driverId } }) : null;
    const brokerId = f.str("brokerId");
    const customerId = f.req("customerId", "Customer");
    if (brokerId === customerId) throw new FormError("Broker and customer can't be the same company");

    const data = {
      customerId,
      brokerId,
      customerRef: f.str("customerRef"),
      teamId: f.str("teamId") ?? driver?.teamId ?? null,
      priority: f.str("priority") ?? "NORMAL",
      ...summary,
      distanceKm,
      emptyKm: f.num("emptyKm") ?? 0,
      commodity: f.req("commodity", "Commodity"),
      weightKg: f.num("weightKg") ?? 0,
      pallets: f.num("pallets"),
      equipment: f.str("equipment") ?? "DRY_VAN",
      temperatureC: f.num("temperatureC"),
      hazmat: f.bool("hazmat"),
      rate: f.num("rate") ?? 0,
      driverPay: f.num("driverPay") ?? (driver ? Math.round(distanceKm * driver.payPerKm) : 0),
      fuelCost: f.num("fuelCost") ?? Math.round(distanceKm * 0.3),
      otherCost: f.num("otherCost") ?? 0,
      notes: f.str("notes"),
      truckId, driverId, trailerId,
    };

    if (loadId && existing) {
      // Booked + truck and driver → dispatched; dispatched with either cleared → back to booked.
      const status = existing.status === "PLANNED" && truckId && driverId ? "ASSIGNED"
        : existing.status === "ASSIGNED" && !(truckId && driverId) ? "PLANNED"
        : existing.status;
      await db.load.update({ where: { id: loadId }, data: { ...data, status } });
      if (!locked) {
        await db.stop.deleteMany({ where: { loadId } });
        await db.stop.createMany({ data: stops.map((s) => ({ ...s, loadId })) });
      }
      const now = new Date();
      // A dispatched load holds its trailer: release it when it is swapped out or the load goes back to booked.
      if (existing.status === "ASSIGNED" && existing.trailerId && (existing.trailerId !== trailerId || status === "PLANNED")) {
        await db.trailer.update({ where: { id: existing.trailerId }, data: { status: "EMPTY", statusSince: now } });
      }
      if (trailerId && status === "ASSIGNED") await db.trailer.update({ where: { id: trailerId }, data: { status: "IN_USE", statusSince: now, truckId } });
      await db.loadEvent.create({ data: { loadId, type: "EDIT", message: "Load details updated", userId: me.id } });
      if (status === "PLANNED" && existing.status === "ASSIGNED") {
        await db.loadEvent.create({ data: { loadId, type: "STATUS", message: "Unassigned — back to planning", userId: me.id } });
      }
      if (existing.driverId && existing.driverId !== driverId) await syncDriverBoardStatus(existing.driverId, me.id, { force: true });
      if (driverId) await syncDriverBoardStatus(driverId, me.id, { force: true });
      await audit(me.id, "update", "load", loadId, existing.reference);
    } else {
      const reference = await nextLoadReference();
      const assigned = Boolean(truckId && driverId);
      const load = await db.load.create({
        data: { ...data, reference, status: assigned ? "ASSIGNED" : "PLANNED", dispatcherId: me.id, stops: { create: stops } },
      });
      id = load.id;
      await db.loadEvent.create({ data: { loadId: load.id, type: "CREATED", message: `Load created for ${data.commodity} (${stops.length} stops)`, userId: me.id } });
      if (assigned) {
        await db.loadEvent.create({ data: { loadId: load.id, type: "ASSIGNED", message: "Truck, trailer and driver assigned", userId: me.id } });
        await syncDriverBoardStatus(driverId!, me.id, { force: true });
        if (trailerId) await db.trailer.update({ where: { id: trailerId }, data: { status: "IN_USE", statusSince: new Date(), truckId } });
        after(() => notifyLoadAssigned(load.id));
      }
      await audit(me.id, "create", "load", load.id, reference);
    }
  });
  if (res?.error) return res;
  revalidatePath("/loads");
  revalidatePath("/dispatch");
  redirect(`/loads/${id}`);
}

export async function assignLoad(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truckId = f.req("truckId", "Truck");
    const driverId = f.req("driverId", "Driver");
    const trailerId = f.str("trailerId");
    const load = await db.load.findUniqueOrThrow({ where: { id: loadId } });
    if (!["PLANNED", "ASSIGNED"].includes(load.status)) throw new FormError("Only booked or dispatched loads can be (re)assigned — use Recover for loads in transit");
    await assertAvailable(loadId, { truckId, driverId, trailerId }, { start: load.pickupAt, end: load.deliveryAt });
    const [truck, driver] = await Promise.all([
      db.truck.findUniqueOrThrow({ where: { id: truckId } }),
      db.driver.findUniqueOrThrow({ where: { id: driverId } }),
    ]);
    if (load.trailerId && load.trailerId !== trailerId) await db.trailer.update({ where: { id: load.trailerId }, data: { status: "EMPTY", statusSince: new Date() } });
    await db.load.update({
      where: { id: loadId },
      data: { truckId, driverId, trailerId, status: "ASSIGNED", teamId: load.teamId ?? driver.teamId, driverPay: Math.round(load.distanceKm * driver.payPerKm) },
    });
    if (trailerId) await db.trailer.update({ where: { id: trailerId }, data: { status: "IN_USE", statusSince: new Date(), truckId } });
    if (load.driverId && load.driverId !== driverId) await syncDriverBoardStatus(load.driverId, me.id, { force: true });
    await syncDriverBoardStatus(driverId, me.id, { force: true });
    await db.loadEvent.create({ data: { loadId, type: "ASSIGNED", message: `Assigned ${truck.unitNumber} · ${driver.name}`, userId: me.id } });
    after(() => notifyLoadAssigned(loadId));
    await audit(me.id, "assign", "load", loadId, `${load.reference} → ${truck.unitNumber}/${driver.name}`);
    revalidatePath(`/loads/${loadId}`);
    revalidatePath("/dispatch");
    return { ok: "Assignment saved" };
  });
}

/** Move a load (even one in transit) to another truck/driver — breakdown, HOS, swap at a yard. */
export async function recoverLoad(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  return attempt(async () => {
    const f = fields(fd);
    const truckId = f.req("truckId", "Truck");
    const driverId = f.req("driverId", "Driver");
    const trailerId = f.str("trailerId");
    const reason = f.str("reason");
    const load = await db.load.findUniqueOrThrow({ where: { id: loadId }, include: { truck: true, driver: true } });
    if (!["ASSIGNED", "IN_TRANSIT"].includes(load.status)) throw new FormError("Only dispatched or in-transit loads can be recovered");
    // The new unit has to be free from now (or the pickup, if later) until delivery.
    const now = new Date();
    const start = load.status === "IN_TRANSIT" || load.pickupAt < now ? now : load.pickupAt;
    await assertAvailable(loadId, { truckId, driverId, trailerId: trailerId ?? undefined }, { start, end: load.deliveryAt > start ? load.deliveryAt : start });
    const [truck, driver] = await Promise.all([db.truck.findUniqueOrThrow({ where: { id: truckId } }), db.driver.findUniqueOrThrow({ where: { id: driverId } })]);
    await db.load.update({ where: { id: loadId }, data: { truckId, driverId, trailerId: trailerId ?? load.trailerId, driverPay: Math.round(load.distanceKm * driver.payPerKm) } });
    // Swapping trailers (transload) frees the old one.
    if (trailerId && load.trailerId && load.trailerId !== trailerId) await db.trailer.update({ where: { id: load.trailerId }, data: { status: "EMPTY", statusSince: now } });
    const finalTrailer = trailerId ?? load.trailerId;
    if (finalTrailer) await db.trailer.update({ where: { id: finalTrailer }, data: { status: "IN_USE", statusSince: now, truckId } });
    if (load.driverId) await syncDriverBoardStatus(load.driverId, me.id, { force: true });
    await syncDriverBoardStatus(driverId, me.id, { force: true });
    const from = `${load.truck?.unitNumber ?? "—"} · ${load.driver?.name ?? "—"}`;
    await db.loadEvent.create({ data: { loadId, type: "ASSIGNED", message: `Recovered: moved from ${from} to ${truck.unitNumber} · ${driver.name}${reason ? ` — ${reason}` : ""}`, userId: me.id } });
    await audit(me.id, "recover", "load", loadId, `${load.reference}: ${from} → ${truck.unitNumber}/${driver.name}`);
    revalidatePath(`/loads/${loadId}`);
    revalidatePath("/dispatch");
    return { ok: `Moved to ${truck.unitNumber} · ${driver.name}` };
  });
}

export async function setLoadStatus(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  return attempt(async () => {
    const to = String(fd.get("status")) as LoadStatus;
    if (!LOAD_STATUSES.includes(to)) throw new FormError("Invalid status");
    const f = fields(fd);
    await transitionLoad(loadId, to, me.id, { podSignedBy: f.str("podSignedBy"), reason: f.str("reason") });
    revalidatePath(`/loads/${loadId}`);
    revalidatePath("/loads");
    revalidatePath("/dispatch");
    return { ok: "Status updated" };
  });
}

/** Dispatcher marks a stop arrived / completed on behalf of the driver. Rule violations come back as { error }. */
export async function updateStop(loadId: string, stopId: string, action: "arrive" | "complete"): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  const res = await attempt(async () => {
    if (action === "arrive") await arriveAtStop(loadId, stopId, me.id);
    else {
      const last = await completeStop(loadId, stopId, me.id);
      if (last) {
        const load = await db.load.findUniqueOrThrow({ where: { id: loadId } });
        if (load.status === "IN_TRANSIT") await transitionLoad(loadId, "DELIVERED", me.id);
      }
    }
  });
  revalidatePath(`/loads/${loadId}`);
  revalidatePath("/dispatch");
  return res;
}

export async function addLoadEvent(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  return attempt(async () => {
    const f = fields(fd);
    const message = f.req("message", "Message");
    const type = f.str("type") ?? "NOTE";
    if (!["NOTE", "CHECK_CALL", "ISSUE"].includes(type)) throw new FormError("Invalid type");
    if (me.role === "DRIVER") {
      const load = await db.load.findUnique({ where: { id: loadId } });
      if (load?.driverId !== me.driver?.id) throw new FormError("Not your load");
    }
    await db.loadEvent.create({ data: { loadId, type, message, userId: me.id } });
    if (type === "ISSUE") after(() => notifyLoadIssue(loadId, message, me.id));
    revalidatePath(`/loads/${loadId}`);
    revalidatePath("/driver");
    return { ok: "Added to timeline" };
  });
}

export async function deleteLoad(loadId: string): Promise<ActionState> {
  const me = await requireUser("users.manage");
  const res = await attempt(async () => {
    const load = await db.load.findUnique({ where: { id: loadId } });
    if (!load) throw new FormError("This load no longer exists.");
    if (!["PLANNED", "CANCELLED"].includes(load.status)) throw new FormError("Only booked or cancelled loads can be deleted.");
    await db.load.delete({ where: { id: loadId } });
    await audit(me.id, "delete", "load", loadId, load.reference);
  });
  if (res?.error) return res;
  revalidatePath("/loads");
  redirect("/loads");
}
