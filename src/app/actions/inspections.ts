"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { DEFECT_SEVERITIES, PTI_COMPONENTS, PTI_RATINGS } from "@/lib/constants";
import { dateOnly, makeFormat, normalizeLocale } from "@/lib/locale";
import { defectLabel, roLabel } from "@/lib/service";
import { companyMembers, createDefect, dueFor, resolveWeek, syncUnitHold, type HoldChange, type UnitRef } from "@/lib/pti";
import {
  BOARD_FILTERS, DEFECT_COMPONENTS, RATING_SEVERITY, SEVERITY_RANK, VERDICTS, WITHDRAWN_NOTE, boardHref, componentLabel, type Verdict,
} from "@/lib/pti-shared";

/*
 * Weekly walk-around reviews and defects. Every change is audited; anything that touches a holding defect goes
 * through syncUnitHold (src/lib/pti.ts), which applies the out-of-service rule to the unit.
 */

const formatFor = (me: CurrentUser) => makeFormat(normalizeLocale(me.company));

function revalidateInspections(units: UnitRef[] = []) {
  revalidatePath("/inspections");
  revalidatePath("/inspections/defects");
  revalidatePath("/dashboard");
  revalidatePath("/fleet");
  revalidatePath("/fleet/trailers");
  for (const u of units) {
    if (u.truckId) revalidatePath(`/fleet/${u.truckId}`);
    if (u.trailerId) revalidatePath(`/fleet/trailers/${u.trailerId}`);
  }
}

/** " 005 is out of service until someone confirms the repair." / " 005 is back in service." */
function holdNote(h: HoldChange) {
  const parts: string[] = [];
  if (h.held.length) parts.push(`${h.held.join(", ")} ${h.held.length === 1 ? "is" : "are"} out of service until someone confirms the repair.`);
  if (h.released.length) parts.push(`${h.released.join(", ")} ${h.released.length === 1 ? "is" : "are"} back in service.`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

const merge = (a: HoldChange, b: HoldChange): HoldChange => ({ held: [...a.held, ...b.held], released: [...a.released, ...b.released] });

/* ------------------------------------------------------------------ */
/* Walk-around review                                                  */
/* ------------------------------------------------------------------ */

/**
 * Save the review of one truck's walk-around for one week (creating the week's row if nobody recorded anything yet).
 * Video missing: only that is recorded. Video received: verdicts on earlier defects, a rating per component (anything
 * Soon / Now becomes a tracked defect; Not seen is kept as a rating, never as healthy), and the week is marked reviewed.
 * "No issues" never closes an older defect: only a "Fixed" verdict does. Redirects back to the board (or to the next
 * truck to review).
 */
export async function saveWalkAroundReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  const f = formatFor(me);
  let target = "";
  let truckRef: UnitRef = {};
  const res = await attempt(async () => {
    const v = fields(fd, me.company.timezone);
    const truckId = v.req("truckId", "Truck");
    const weekKey = v.req("week", "Week");
    const week = resolveWeek(f, weekKey);
    if (week.key !== weekKey) throw new FormError("That week can't be reviewed yet. Pick a week from the board.");
    const video = v.str("video");
    if (video !== "RECEIVED" && video !== "MISSING") throw new FormError("Say whether the video came in.");
    const show = v.str("show");
    const nextTruck = v.str("after") === "next" ? v.str("nextTruck") : null;

    const truck = await db.truck.findUnique({ where: { id: truckId }, select: { id: true, unitNumber: true, driverId: true } });
    if (!truck) throw new FormError("This truck no longer exists.");
    truckRef = { truckId };
    const weekStart = dateOnly(week.key);
    const where = { truckId_weekStart: { truckId, weekStart } };
    const existing = await db.walkAround.findUnique({ where });
    // Someone else saved this review while the drawer was open: show theirs rather than overwrite it.
    if ((existing?.reviewedAt?.toISOString() ?? "") !== (v.str("reviewedStamp") ?? "")) {
      throw new FormError(`${truck.unitNumber} was reviewed by someone else while this was open. Close it and open the review again to see theirs.`);
    }
    const now = new Date();
    const notes = v.str("notes");
    const back = { week: week.isCurrent ? undefined : week.key, show: show && (BOARD_FILTERS as readonly string[]).includes(show) ? show : undefined };

    if (video === "MISSING") {
      // Also after a review (it was marked received by mistake): the review is withdrawn. Defects it raised close with
      // WITHDRAWN_NOTE (and release the truck if they held it); the marks stay, so switching back to received and
      // saving restores the review and reopens those same defects.
      let withdrawn: number[] = [];
      let hold: HoldChange = { held: [], released: [] };
      if (existing) {
        const raised = await db.defect.findMany({ where: { walkAroundId: existing.id, status: { in: ["OPEN", "REPAIRED"] } }, select: { id: true, number: true, holdsUnit: true } });
        if (raised.length) {
          await db.defect.updateMany({
            where: { id: { in: raised.map((d) => d.id) } },
            data: { status: "CLOSED", holdsUnit: false, closedAt: now, closedById: me.id, closeNote: `${WITHDRAWN_NOTE} (week of ${f.day(week.at)})` },
          });
          for (const d of raised) await audit(me.id, "close", "defect", d.id, `${defectLabel(d.number)} withdrawn: ${truck.unitNumber}'s video marked missing`);
          withdrawn = raised.map((d) => d.number);
          hold = await syncUnitHold({ truckId }, { released: raised.some((d) => d.holdsUnit) });
        }
      }
      const wa = await db.walkAround.upsert({
        where,
        create: { truckId, weekStart, driverId: truck.driverId, video: "MISSING", notes },
        update: { video: "MISSING", receivedAt: null, result: null, reviewedAt: null, reviewedById: null, notes },
      });
      await audit(me.id, "video_missing", "walk_around", wa.id, [
        `${truck.unitNumber} · week of ${week.key}`,
        existing?.reviewedAt ? "review withdrawn" : null,
        withdrawn.length ? `closed ${withdrawn.map(defectLabel).join(", ")}` : null,
        hold.released.length ? "back in service" : null,
      ].filter(Boolean).join(" · "));
      target = boardHref({ ...back, review: nextTruck ?? undefined, saved: truckId });
      return;
    }

    // Read and check everything before changing anything, so a refusal leaves no half-saved review.
    const ratings: Record<string, string> = {};
    for (const c of PTI_COMPONENTS) {
      const r = v.str(`rating_${c}`) ?? "GOOD";
      if (!(PTI_RATINGS as readonly string[]).includes(r)) throw new FormError(`Pick a rating for ${componentLabel(c).toLowerCase()}.`);
      ratings[c] = r;
    }
    const open = await db.defect.findMany({ where: { truckId, status: { in: ["OPEN", "REPAIRED"] } }, orderBy: { number: "asc" } });
    // This walk-around's own defects, including those a "missing" mark withdrew (saving again reopens them).
    const withdrawnOwn = existing
      ? await db.defect.findMany({ where: { walkAroundId: existing.id, status: "CLOSED", closeNote: { startsWith: WITHDRAWN_NOTE } }, orderBy: { number: "asc" } })
      : [];
    const mine = [...open.filter((d) => existing && d.walkAroundId === existing.id), ...withdrawnOwn];
    const earlier = open.filter((d) => !existing || d.walkAroundId !== existing.id);
    const verdicts = new Map<string, Verdict>();
    for (const d of earlier) {
      const raw = v.str(`verdict_${d.id}`) ?? "UNSEEN";
      if (!(VERDICTS as readonly string[]).includes(raw)) throw new FormError(`Pick what you saw for ${defectLabel(d.number)}.`);
      verdicts.set(d.id, raw as Verdict);
    }
    const stillTracked = (component: string) => earlier.find((d) => d.component === component && verdicts.get(d.id) !== "FIXED");
    for (const c of PTI_COMPONENTS) {
      if (!RATING_SEVERITY[ratings[c]]) continue;
      if (mine.some((d) => d.component === c) || stillTracked(c)) continue;
      if (!v.str(`desc_${c}`)) throw new FormError(`Say what you saw on the ${componentLabel(c).toLowerCase()} (rated ${ratings[c] === "NOW" ? "Now" : "Soon"}).`);
    }

    const wa = await db.walkAround.upsert({
      where,
      create: { truckId, weekStart, driverId: truck.driverId, video: "RECEIVED", receivedAt: now },
      update: { video: "RECEIVED", receivedAt: existing?.receivedAt ?? now },
    });

    let released = false;
    const closed: number[] = [];
    let still = 0;
    const weekOf = f.day(week.at);
    /** Status of each earlier defect once its verdict is applied. */
    const statusAfter = new Map(earlier.map((d) => [d.id, d.status]));
    for (const d of earlier) {
      let verdict = verdicts.get(d.id) ?? "UNSEEN";
      if (verdict === "LOOKS_FIXED" && RATING_SEVERITY[ratings[d.component]]) {
        // Rated Soon / Now again on the same video: the rating wins over "looks fixed".
        verdict = "STILL";
        verdicts.set(d.id, verdict);
      }
      if (verdict === "FIXED") {
        const note = v.str(`fixNote_${d.id}`);
        await db.defect.update({
          where: { id: d.id },
          data: { status: "CLOSED", holdsUnit: false, closedAt: now, closedById: me.id, repairedAt: d.repairedAt ?? now, closeNote: note ?? `Fixed: seen on the walk-around of the week of ${weekOf}` },
        });
        await audit(me.id, "close", "defect", d.id, `${defectLabel(d.number)} fixed on ${truck.unitNumber}'s walk-around`);
        if (d.holdsUnit) released = true;
        closed.push(d.number);
      } else if (verdict === "STILL") {
        still++;
        if (d.status === "REPAIRED") {
          await db.defect.update({ where: { id: d.id }, data: { status: "OPEN", repairedAt: null } });
          await audit(me.id, "reopen", "defect", d.id, `${defectLabel(d.number)} still there on ${truck.unitNumber}'s walk-around`);
          statusAfter.set(d.id, "OPEN");
        }
      } else if (verdict === "LOOKS_FIXED" && d.status === "OPEN") {
        await db.defect.update({ where: { id: d.id }, data: { status: "REPAIRED", repairedAt: now } });
        await audit(me.id, "repaired", "defect", d.id, `${defectLabel(d.number)} looks fixed on ${truck.unitNumber}'s walk-around`);
        statusAfter.set(d.id, "REPAIRED");
      }
    }

    const created: number[] = [];
    for (const c of PTI_COMPONENTS) {
      const severity = RATING_SEVERITY[ratings[c]];
      const desc = v.str(`desc_${c}`);
      const own = mine.find((d) => d.component === c);
      if (!severity) {
        // Re-review: something this walk-around had flagged is now rated good (or not seen).
        if (own && own.status !== "CLOSED") {
          await db.defect.update({
            where: { id: own.id },
            data: { status: "CLOSED", holdsUnit: false, closedAt: now, closedById: me.id, closeNote: `Rated ${ratings[c] === "GOOD" ? "good" : "not seen"} when the review was saved again` },
          });
          await audit(me.id, "close", "defect", own.id, `${defectLabel(own.number)} withdrawn on re-review`);
          if (own.holdsUnit) released = true;
        }
        continue;
      }
      if (own) {
        if (own.holdsUnit && severity !== "NOW") released = true;
        const reopen = own.status === "CLOSED"; // withdrawn by a "missing" mark, now back
        await db.defect.update({
          where: { id: own.id },
          data: {
            severity, holdsUnit: severity === "NOW", description: desc ?? own.description, dueAt: dueFor(severity, own.foundAt), status: "OPEN", repairedAt: null,
            ...(reopen ? { closedAt: null, closedById: null, closeNote: null } : {}),
          },
        });
        if (reopen) await audit(me.id, "reopen", "defect", own.id, `${defectLabel(own.number)} restored: ${truck.unitNumber}'s video marked received again`);
        else if (own.severity !== severity || (desc && desc !== own.description)) await audit(me.id, "update", "defect", own.id, `${defectLabel(own.number)} → ${severity}`);
        continue;
      }
      const tracked = stillTracked(c);
      if (tracked) {
        // Already tracked from an earlier week: keep that defect, raise it to Now if it got worse, reopen it if it was marked repaired.
        const worse = SEVERITY_RANK[severity] < (SEVERITY_RANK[tracked.severity] ?? 9);
        if (worse || statusAfter.get(tracked.id) === "REPAIRED") {
          await db.defect.update({
            where: { id: tracked.id },
            data: {
              status: "OPEN", repairedAt: null,
              ...(worse ? { severity, holdsUnit: tracked.holdsUnit || severity === "NOW", dueAt: dueFor(severity, now) } : {}),
            },
          });
          await audit(me.id, "update", "defect", tracked.id, `${defectLabel(tracked.number)} ${worse ? `raised to ${severity}` : "reopened"} on ${truck.unitNumber}'s walk-around`);
        }
        continue;
      }
      const d = await createDefect({
        truckId, walkAroundId: wa.id, component: c, description: desc!, severity, holdsUnit: severity === "NOW", foundAt: now, dueAt: dueFor(severity, now),
      });
      await audit(me.id, "create", "defect", d.id, `${defectLabel(d.number)} ${componentLabel(c)} (${severity}) on ${truck.unitNumber}`);
      created.push(d.number);
    }

    await db.walkAroundRating.deleteMany({ where: { walkAroundId: wa.id } });
    await db.walkAroundRating.createMany({ data: PTI_COMPONENTS.map((c) => ({ walkAroundId: wa.id, component: c, rating: ratings[c] })) });
    const issues = PTI_COMPONENTS.some((c) => RATING_SEVERITY[ratings[c]]) || still > 0;
    await db.walkAround.update({
      where: { id: wa.id },
      data: { result: issues ? "ISSUES" : "CLEAN", reviewedById: me.id, reviewedAt: now, notes, driverId: existing?.driverId ?? truck.driverId },
    });
    const hold = await syncUnitHold({ truckId }, { released });
    await audit(me.id, "review", "walk_around", wa.id, [
      `${truck.unitNumber} · week of ${week.key}: ${issues ? "issues" : "clean"}`,
      created.length ? `new ${created.map(defectLabel).join(", ")}` : null,
      closed.length ? `closed ${closed.map(defectLabel).join(", ")}` : null,
      hold.held.length ? "out of service" : null,
      hold.released.length ? "back in service" : null,
    ].filter(Boolean).join(" · "));
    target = boardHref({ ...back, review: nextTruck ?? undefined, saved: truckId });
  });
  if (res?.error) return res;
  revalidateInspections([truckRef]);
  redirect(target);
}

/* ------------------------------------------------------------------ */
/* Defects                                                             */
/* ------------------------------------------------------------------ */

/** "Report a defect": a unit, a component, what is wrong and how soon it must be fixed. */
export async function reportDefect(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let unit: UnitRef = {};
  const res = await attempt(async () => {
    const v = fields(fd, me.company.timezone);
    const kind = v.str("unitType") === "trailer" ? "trailer" : "truck";
    const unitId = v.req(kind === "trailer" ? "trailerId" : "truckId", kind === "trailer" ? "Trailer" : "Truck");
    const component = v.req("component", "Component");
    if (!(DEFECT_COMPONENTS as readonly string[]).includes(component)) throw new FormError("Pick a component from the list.");
    const severity = v.req("severity", "How soon");
    if (!(DEFECT_SEVERITIES as readonly string[]).includes(severity)) throw new FormError("Pick how soon it must be fixed.");
    const description = v.req("description", "What is wrong");
    const ownerId = v.str("ownerId");
    if (ownerId && !(await companyMembers(me.company.id)).some((m) => m.id === ownerId)) throw new FormError("Pick an owner from this company.");
    const label = kind === "trailer"
      ? (await db.trailer.findUnique({ where: { id: unitId }, select: { unitNumber: true } }))?.unitNumber
      : (await db.truck.findUnique({ where: { id: unitId }, select: { unitNumber: true } }))?.unitNumber;
    if (!label) throw new FormError(`This ${kind} no longer exists.`);
    unit = kind === "trailer" ? { trailerId: unitId } : { truckId: unitId };
    const now = new Date();
    const d = await createDefect({ ...unit, component, description, severity, holdsUnit: severity === "NOW", foundAt: now, dueAt: dueFor(severity, now), ownerId });
    await audit(me.id, "create", "defect", d.id, `${defectLabel(d.number)} ${componentLabel(component)} (${severity}) on ${label}, reported`);
    const hold = await syncUnitHold(unit);
    return { ok: `Reported ${defectLabel(d.number)} on ${label}.${holdNote(hold)}` };
  });
  revalidateInspections([unit]);
  return res;
}

async function findDefect(id: string) {
  const d = await db.defect.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, severity: true, holdsUnit: true, repairedAt: true, truckId: true, trailerId: true },
  });
  if (!d) throw new FormError("This defect no longer exists. Refresh the page.");
  return d;
}

/** Give a defect an owner (a member of this company), or none. */
export async function assignDefectOwner(id: string, ownerId: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const d = await findDefect(id);
    const members = await companyMembers(me.company.id);
    const owner = ownerId ? members.find((m) => m.id === ownerId) : null;
    if (ownerId && !owner) throw new FormError("Pick an owner from this company.");
    await db.defect.update({ where: { id }, data: { ownerId: owner?.id ?? null } });
    await audit(me.id, "assign", "defect", id, `${defectLabel(d.number)} → ${owner?.name ?? "nobody"}`);
    revalidateInspections([d]);
    return { ok: owner ? `${defectLabel(d.number)} is ${owner.id === me.id ? "yours" : `${owner.name}'s`} now` : `${defectLabel(d.number)} has no owner` };
  });
}

/** Tie a defect to an open repair order of the same unit (or untie it). */
export async function linkDefectRepair(id: string, workOrderId: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const d = await findDefect(id);
    let label = "no repair";
    if (workOrderId) {
      const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { number: true, truckId: true, trailerId: true, status: true, voidedAt: true } });
      if (!wo) throw new FormError("That repair order no longer exists.");
      const sameUnit = (d.truckId && wo.truckId === d.truckId) || (d.trailerId && wo.trailerId === d.trailerId);
      if (!sameUnit) throw new FormError("Pick a repair order of the same unit.");
      label = roLabel(wo.number);
    }
    await db.defect.update({ where: { id }, data: { workOrderId } });
    await audit(me.id, "link_repair", "defect", id, `${defectLabel(d.number)} → ${label}`);
    revalidateInspections([d]);
    if (workOrderId) revalidatePath(`/maintenance/work-orders/${workOrderId}`);
    return { ok: workOrderId ? `${defectLabel(d.number)} linked to ${label}` : `${defectLabel(d.number)} unlinked` };
  });
}

/** The shop says it is fixed: repaired, waiting for someone to confirm. A holding defect keeps holding the unit. */
export async function markDefectRepaired(id: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const d = await findDefect(id);
    if (d.status !== "OPEN") throw new FormError(`${defectLabel(d.number)} is already ${d.status === "CLOSED" ? "closed" : "marked repaired"}.`);
    await db.defect.update({ where: { id }, data: { status: "REPAIRED", repairedAt: new Date() } });
    await audit(me.id, "repaired", "defect", id, defectLabel(d.number));
    revalidateInspections([d]);
    return { ok: `${defectLabel(d.number)} marked repaired.${d.holdsUnit ? " Confirm it to put the unit back in service." : " Confirm it to close it."}` };
  });
}

async function closeOne(me: CurrentUser, d: Awaited<ReturnType<typeof findDefect>>, note: string | null, now: Date) {
  await db.defect.update({
    where: { id: d.id },
    data: { status: "CLOSED", holdsUnit: false, closedAt: now, closedById: me.id, closeNote: note, repairedAt: d.repairedAt ?? now },
  });
  await audit(me.id, "close", "defect", d.id, `${defectLabel(d.number)} confirmed and closed${note ? `: ${note}` : ""}`);
}

/** Confirm the repair and close the defect; the last holding defect puts its unit back in service. */
export async function closeDefect(id: string, note: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const d = await findDefect(id);
    if (d.status === "CLOSED") throw new FormError(`${defectLabel(d.number)} is already closed.`);
    await closeOne(me, d, note?.trim() || null, new Date());
    const hold = await syncUnitHold(d, { released: d.holdsUnit });
    revalidateInspections([d]);
    return { ok: `${defectLabel(d.number)} closed.${holdNote(hold)}` };
  });
}

/** Board "Confirm & clear": confirm every repaired defect of a truck at once. */
export async function confirmTruckRepairs(truckId: string, note: string | null): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const list = await db.defect.findMany({
      where: { truckId, status: "REPAIRED" },
      select: { id: true, number: true, status: true, severity: true, holdsUnit: true, repairedAt: true, truckId: true, trailerId: true },
    });
    if (!list.length) throw new FormError("Nothing on this truck is waiting to be confirmed. Refresh the page.");
    const now = new Date();
    for (const d of list) await closeOne(me, d, note?.trim() || null, now);
    let hold = await syncUnitHold({ truckId }, { released: list.some((d) => d.holdsUnit) });
    for (const t of new Set(list.map((d) => d.trailerId).filter((x): x is string => Boolean(x)))) {
      hold = merge(hold, await syncUnitHold({ trailerId: t }, { released: true }));
    }
    revalidateInspections([{ truckId }]);
    return { ok: `Confirmed ${list.map((d) => defectLabel(d.number)).join(", ")}.${holdNote(hold)}` };
  });
}

/** Not fixed after all: back to open. A Now defect takes its unit out of service again. */
export async function reopenDefect(id: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const d = await findDefect(id);
    if (d.status === "OPEN") throw new FormError(`${defectLabel(d.number)} is already open.`);
    const holds = d.severity === "NOW";
    await db.defect.update({ where: { id }, data: { status: "OPEN", repairedAt: null, closedAt: null, closedById: null, holdsUnit: holds || d.holdsUnit } });
    await audit(me.id, "reopen", "defect", id, defectLabel(d.number));
    const hold = await syncUnitHold(d);
    revalidateInspections([d]);
    return { ok: `${defectLabel(d.number)} is open again.${holdNote(hold)}` };
  });
}
