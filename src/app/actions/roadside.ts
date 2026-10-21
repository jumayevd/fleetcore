"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { INSPECTION_LEVELS, ROADSIDE_STATUSES } from "@/lib/constants";
import { VIOLATION_UNITS, roadsideResult } from "@/lib/pti-shared";

/*
 * Roadside (DOT) inspections: the report, its violations, and getting them corrected.
 * The result is derived from the violations (out of service if any is OOS, violations if any, else clean).
 */

type Refs = { id?: string | null; driverId?: string | null; truckId?: string | null; trailerId?: string | null };

function revalidateRoadside(r: Refs) {
  revalidatePath("/inspections/roadside");
  if (r.id) revalidatePath(`/inspections/roadside/${r.id}`);
  if (r.truckId) revalidatePath(`/fleet/${r.truckId}`);
  if (r.trailerId) revalidatePath(`/fleet/trailers/${r.trailerId}`);
  if (r.driverId) revalidatePath(`/drivers/${r.driverId}`);
  revalidatePath("/dashboard");
}

type Line = { id?: string; code: string | null; description: string; unit: string; oos: boolean; corrected?: boolean };

function parseLines(raw: string | null): Line[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new FormError("The violations could not be read. Reload the page and try again."); }
  if (!Array.isArray(data)) throw new FormError("The violations could not be read. Reload the page and try again.");
  const out: Line[] = [];
  data.forEach((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const description = typeof o.description === "string" ? o.description.trim() : "";
    const code = typeof o.code === "string" && o.code.trim() ? o.code.trim().slice(0, 40) : null;
    if (!description && !code) return; // an empty line someone added and left
    if (!description) throw new FormError(`Violation ${i + 1}: say what it was.`);
    const unit = typeof o.unit === "string" && (VIOLATION_UNITS as readonly string[]).includes(o.unit) ? o.unit : "TRUCK";
    out.push({ id: typeof o.id === "string" ? o.id : undefined, code, description: description.slice(0, 500), unit, oos: o.oos === true, corrected: o.corrected === true });
  });
  return out;
}

/** Create or edit a roadside inspection with its violations. Redirects to the inspection. */
export async function saveRoadside(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let savedId = id;
  const touched: Refs[] = [];
  const res = await attempt(async () => {
    const v = fields(fd, me.company.timezone);
    const inspectedAt = v.date("inspectedAt");
    if (!inspectedAt) throw new FormError("When was the inspection? Add the date and time.");
    if (inspectedAt.getTime() > Date.now() + 3600_000) throw new FormError("The inspection date is in the future.");
    const level = Number(v.str("level") ?? "1");
    if (!(INSPECTION_LEVELS as readonly number[]).includes(level)) throw new FormError("Pick the inspection level.");
    const status = v.str("status") ?? "OPEN";
    if (!(ROADSIDE_STATUSES as readonly string[]).includes(status)) throw new FormError("Pick a status.");
    const driverId = v.str("driverId");
    const truckId = v.str("truckId");
    const trailerId = v.str("trailerId");
    if (!driverId && !truckId && !trailerId) throw new FormError("Pick the driver, truck or trailer that was inspected.");
    const lines = parseLines(v.str("violations"));
    const correctionDueAt = v.date("correctionDueAt");
    const state = v.str("state")?.toUpperCase().slice(0, 3) ?? null;
    const data = {
      inspectedAt, level, status, driverId, truckId, trailerId, correctionDueAt, state,
      reportNumber: v.str("reportNumber")?.slice(0, 60) ?? null,
      location: v.str("location")?.slice(0, 120) ?? null,
      notes: v.str("notes"),
      result: roadsideResult(lines),
    };
    const now = new Date();

    if (id) {
      const prev = await db.roadsideInspection.findUnique({ where: { id }, include: { violations: true } });
      if (!prev) throw new FormError("This inspection no longer exists.");
      await db.roadsideInspection.update({ where: { id }, data });
      const keep = new Set(lines.map((l) => l.id).filter(Boolean));
      const gone = prev.violations.filter((x) => !keep.has(x.id)).map((x) => x.id);
      if (gone.length) await db.roadsideViolation.deleteMany({ where: { inspectionId: id, id: { in: gone } } });
      for (const l of lines) {
        const old = l.id ? prev.violations.find((x) => x.id === l.id) : undefined;
        const correctedAt = l.corrected ? (old?.correctedAt ?? now) : null;
        if (old) await db.roadsideViolation.update({ where: { id: old.id }, data: { code: l.code, description: l.description, unit: l.unit, oos: l.oos, correctedAt } });
        else await db.roadsideViolation.create({ data: { inspectionId: id, code: l.code, description: l.description, unit: l.unit, oos: l.oos, correctedAt } });
      }
      await audit(me.id, "update", "roadside", id, `${data.reportNumber ?? "Inspection"} · ${data.result} · ${lines.length} violations`);
      touched.push({ id, driverId: prev.driverId, truckId: prev.truckId, trailerId: prev.trailerId });
    } else {
      const r = await db.roadsideInspection.create({ data: { ...data, createdById: me.id } });
      savedId = r.id;
      if (lines.length) {
        await db.roadsideViolation.createMany({
          data: lines.map((l) => ({ inspectionId: r.id, code: l.code, description: l.description, unit: l.unit, oos: l.oos, correctedAt: l.corrected ? now : null })),
        });
      }
      await audit(me.id, "create", "roadside", r.id, `${data.reportNumber ?? "Inspection"} · ${data.result} · ${lines.length} violations`);
    }
    touched.push({ id: savedId, driverId, truckId, trailerId });
  });
  if (res?.error) return res;
  for (const t of touched) revalidateRoadside(t);
  redirect(`/inspections/roadside/${savedId}`);
}

/** Tick one violation as corrected (or not). When every violation is corrected, an open inspection becomes corrected. */
export async function setViolationCorrected(violationId: string, corrected: boolean): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const v = await db.roadsideViolation.findUnique({ where: { id: violationId }, select: { id: true, code: true, description: true, inspectionId: true } });
    if (!v) throw new FormError("This violation no longer exists. Refresh the page.");
    const insp = await db.roadsideInspection.findUnique({ where: { id: v.inspectionId }, select: { id: true, status: true, driverId: true, truckId: true, trailerId: true } });
    if (!insp) throw new FormError("This inspection no longer exists.");
    if (insp.status === "CLOSED") throw new FormError("This inspection is closed. Reopen it to change a violation.");
    await db.roadsideViolation.update({ where: { id: violationId }, data: { correctedAt: corrected ? new Date() : null } });
    const left = await db.roadsideViolation.count({ where: { inspectionId: insp.id, correctedAt: null } });
    let status = insp.status;
    if (left === 0 && insp.status === "OPEN") status = "CORRECTED";
    if (left > 0 && insp.status === "CORRECTED") status = "OPEN";
    if (status !== insp.status) await db.roadsideInspection.update({ where: { id: insp.id }, data: { status } });
    await audit(me.id, corrected ? "corrected" : "uncorrected", "roadside_violation", violationId, `${v.code ? `${v.code} ` : ""}${v.description}`);
    revalidateRoadside(insp);
    return { ok: corrected ? (left === 0 ? "Every violation is corrected." : `Corrected. ${left} still to correct.`) : "Marked not corrected." };
  });
}

/**
 * Move the whole inspection: CORRECTED ticks every violation still open; CLOSED files it; OPEN reopens it.
 */
export async function setRoadsideStatus(id: string, status: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    if (!(ROADSIDE_STATUSES as readonly string[]).includes(status)) throw new FormError("Pick a status.");
    const insp = await db.roadsideInspection.findUnique({ where: { id }, select: { id: true, status: true, reportNumber: true, driverId: true, truckId: true, trailerId: true } });
    if (!insp) throw new FormError("This inspection no longer exists.");
    if (insp.status === status) return { ok: "Nothing to change." };
    if (status === "CORRECTED") await db.roadsideViolation.updateMany({ where: { inspectionId: id, correctedAt: null }, data: { correctedAt: new Date() } });
    await db.roadsideInspection.update({ where: { id }, data: { status } });
    await audit(me.id, "status", "roadside", id, `${insp.reportNumber ?? "Inspection"} → ${status}`);
    revalidateRoadside(insp);
    return { ok: status === "CORRECTED" ? "Marked corrected." : status === "CLOSED" ? "Closed." : "Reopened." };
  });
}
