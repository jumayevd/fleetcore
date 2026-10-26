"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { hint, seal } from "@/lib/secret-box";
import { EldError, fetchTrackProVehicles } from "@/lib/eld/trackpro";
import { PROVIDER, syncCompanyEld, type SyncResult } from "@/lib/eld/sync";

/*
 * Settings → Integrations: connect TrackPro ELD with the carrier's API token, sync, match ELD vehicles to trucks,
 * disconnect. Owners and admins only (company.manage); "Sync now" is open to anyone who edits the fleet.
 */

function refresh() {
  revalidatePath("/admin/integrations");
  revalidatePath("/tracking");
  revalidatePath("/dashboard");
  revalidatePath("/fleet");
  revalidatePath("/maintenance/oil");
}

const syncText = (r: SyncResult) =>
  r.status === "ok" ? `${r.vehicles} ${r.vehicles === 1 ? "truck" : "trucks"} in TrackPro, ${r.matched} matched, ${r.updated} updated`
    : r.status === "error" ? r.message
      : r.status === "skipped" ? "A sync ran a moment ago; the next one starts within a minute."
        : "Not connected.";

/** Save (or replace) the token, after checking it against TrackPro. */
export async function connectEld(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const token = fields(fd).req("token", "The API token").replace(/^Bearer\s+/i, "").trim();
    if (token.length < 12 || /\s/.test(token)) throw new FormError("That doesn't look like a TrackPro API token. Paste the whole token, without spaces.");
    let found: number;
    try {
      found = (await fetchTrackProVehicles(token)).length;
    } catch (e) {
      throw new FormError(e instanceof EldError ? e.message : "Couldn't reach TrackPro. Try again in a minute.");
    }
    const existing = await db.eldConnection.findFirst({ where: { provider: PROVIDER }, select: { id: true } });
    const data = { tokenEnc: seal(token), tokenHint: hint(token), active: true, timeBasis: "AUTO", lastSyncAt: null, lastError: null };
    if (existing) await db.eldConnection.update({ where: { id: existing.id }, data });
    else await db.eldConnection.create({ data: { ...data, provider: PROVIDER } });
    await audit(me.id, existing ? "update" : "create", "integration", null, `TrackPro ELD token ${existing ? "replaced" : "saved"} (${hint(token)})`);
    const r = await syncCompanyEld(me.company.id, { force: true });
    refresh();
    return { ok: r.status === "ok" ? `Connected. ${syncText(r)}.` : `Connected: TrackPro shows ${found} ${found === 1 ? "truck" : "trucks"}. ${syncText(r)}` };
  });
}

export async function syncEldNow(): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const r = await syncCompanyEld(me.company.id, { force: true });
    refresh();
    if (r.status === "error") throw new FormError(r.message);
    if (r.status === "none") throw new FormError("TrackPro isn't connected yet.");
    return { ok: syncText(r) };
  });
}

/** Pick the truck an ELD vehicle belongs to: a truck id, "none" (not in FleetCore), or "auto" (VIN, then unit number). */
export async function matchEldUnit(unitId: string, choice: string): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const unit = await db.eldUnit.findUnique({ where: { id: unitId }, select: { id: true, unitNumber: true } });
    if (!unit) throw new FormError("This ELD vehicle is gone. Sync again.");
    if (choice === "auto") {
      await db.eldUnit.update({ where: { id: unitId }, data: { matchMode: "AUTO" } });
    } else if (choice === "none") {
      await db.eldUnit.update({ where: { id: unitId }, data: { matchMode: "MANUAL", truckId: null } });
    } else {
      const truck = await db.truck.findUnique({ where: { id: choice }, select: { id: true, unitNumber: true } });
      if (!truck) throw new FormError("That truck no longer exists.");
      // One ELD vehicle per truck: whoever had it lets go.
      await db.eldUnit.updateMany({ where: { truckId: truck.id, id: { not: unitId } }, data: { truckId: null, matchMode: "MANUAL" } });
      await db.eldUnit.update({ where: { id: unitId }, data: { matchMode: "MANUAL", truckId: truck.id, gpsDistance: 0, gpsFrom: null } });
    }
    await audit(me.id, "update", "integration", null, `TrackPro unit ${unit.unitNumber ?? unitId} → ${choice === "auto" ? "match automatically" : choice === "none" ? "not in FleetCore" : "truck picked by hand"}`);
    if (choice === "auto") await syncCompanyEld(me.company.id, { force: true });
    refresh();
    return { ok: "Saved" };
  });
}

/** When TrackPro's times (sent without a zone) are read in the wrong zone, pick it by hand. */
export async function setEldTimeBasis(basis: string): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    if (!["AUTO", "UTC", "COMPANY"].includes(basis)) throw new FormError("Pick how TrackPro's times read.");
    await db.eldConnection.updateMany({ where: { provider: PROVIDER }, data: { timeBasis: basis } });
    await audit(me.id, "update", "integration", null, `TrackPro times read as ${basis}`);
    refresh();
    return { ok: "Saved" };
  });
}

/** Forget the token and the ELD vehicles. Trucks keep the last position they got. */
export async function disconnectEld(): Promise<ActionState> {
  const me = await requireUser("company.manage");
  return attempt(async () => {
    const conn = await db.eldConnection.findFirst({ where: { provider: PROVIDER }, select: { id: true, tokenHint: true } });
    if (!conn) return { ok: "Not connected." };
    await db.eldConnection.delete({ where: { id: conn.id } });
    await audit(me.id, "delete", "integration", null, `TrackPro ELD disconnected (${conn.tokenHint})`);
    refresh();
    return { ok: "Disconnected. Trucks keep their last known position." };
  });
}
