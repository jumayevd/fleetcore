/*
 * Pre-trip walk-arounds, defects and roadside inspections: labels, tones, links and small rules shared by server pages
 * and client components. Client-safe (no Prisma, no server-only imports). Server helpers live in src/lib/pti.ts.
 */
import type { Tone } from "@/components/ui";
import {
  DEFECT_SEVERITY_LABELS, DEFECT_STATUS_LABELS, PTI_COMPONENT_LABELS, PTI_COMPONENTS, PTI_RATINGS, ROADSIDE_RESULT_LABELS, ROADSIDE_STATUS_LABELS, humanize,
} from "./constants";

export const DAY_MS = 86_400_000;

/** First value of a search param, trimmed; undefined when empty. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Whole days from `from` to `to` (never negative). */
export const daysBetween = (from: Date | string, to: Date = new Date()) => Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS));

/** Unit numbers sort the way people read them: 2 before 10. */
export const byUnit = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/* ------------------------------------------------------------------ */
/* Components, ratings, defects                                        */
/* ------------------------------------------------------------------ */

/** What a defect can be filed under: the walk-around components plus "Other". */
export const DEFECT_COMPONENTS = [...PTI_COMPONENTS, "OTHER"] as const;
export const componentLabel = (c: string) => PTI_COMPONENT_LABELS[c] ?? (c === "OTHER" ? "Other" : humanize(c));

export const RATING_TONE: Record<string, Tone> = { GOOD: "ok", SOON: "warn", NOW: "danger", UNSEEN: "neutral" };
export const RATING_HINTS: Record<string, string> = {
  GOOD: "Nothing to fix.",
  SOON: "Fix within 2 weeks. Becomes a tracked defect.",
  NOW: "Fix before the next load. Takes the truck out of service until someone confirms the repair.",
  UNSEEN: "Couldn't see it on the video. Recorded as not seen, never as healthy.",
};
/** A rating that becomes a defect, and its severity. GOOD and UNSEEN make none. */
export const RATING_SEVERITY: Record<string, "NOW" | "SOON" | undefined> = { SOON: "SOON", NOW: "NOW" };

/**
 * Ratings a review saved again may give a component. A Soon or Now mark stays on the week's record: it can be raised
 * from Soon to Now while its defect is open, never taken back to Good or Not seen, and once its defect is confirmed
 * fixed it stays exactly as it was.
 */
export function allowedRatings(saved: string | undefined, resolved: boolean): readonly string[] {
  if (!saved || !RATING_SEVERITY[saved]) return PTI_RATINGS;
  return resolved || saved === "NOW" ? [saved] : ["SOON", "NOW"];
}

export const SEVERITY_SHORT: Record<string, string> = { NOW: "Now", SOON: "Soon", WATCH: "Watch" };
export const SEVERITY_TONE: Record<string, Tone> = { NOW: "danger", SOON: "warn", WATCH: "info" };
export const SEVERITY_RANK: Record<string, number> = { NOW: 0, SOON: 1, WATCH: 2 };
export const severityLabel = (s: string) => DEFECT_SEVERITY_LABELS[s] ?? humanize(s);

export const DEFECT_STATUS_TONE: Record<string, Tone> = { OPEN: "warn", REPAIRED: "info", CLOSED: "neutral" };
export const defectStatusLabel = (s: string) => DEFECT_STATUS_LABELS[s] ?? humanize(s);

/** What the reviewer says about a defect found on an earlier walk-around. */
export const VERDICTS = ["FIXED", "STILL", "LOOKS_FIXED", "UNSEEN"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABELS: Record<Verdict, string> = { FIXED: "Fixed", STILL: "Still there", LOOKS_FIXED: "Looks fixed", UNSEEN: "Couldn't see" };
export const VERDICT_HINTS: Record<Verdict, string> = {
  FIXED: "Closes the defect. If it was holding the truck, the truck goes back into service.",
  STILL: "Stays open. A defect marked repaired goes back to open.",
  LOOKS_FIXED: "Marked repaired; someone still has to confirm it before it closes.",
  UNSEEN: "No change.",
};
export const VERDICT_TONE: Record<Verdict, Tone> = { FIXED: "ok", STILL: "danger", LOOKS_FIXED: "info", UNSEEN: "neutral" };

/* ------------------------------------------------------------------ */
/* The weekly board                                                    */
/* ------------------------------------------------------------------ */

/** Where a truck stands this week, worst first. */
export type BoardState = "out_of_service" | "review" | "issues" | "repaired" | "missing" | "partial" | "clean" | "not_expected";
export const BOARD_STATE_RANK: Record<BoardState, number> = {
  out_of_service: 0, review: 1, issues: 2, repaired: 3, missing: 4, partial: 5, clean: 6, not_expected: 7,
};
export const BOARD_STATE_TONE: Record<BoardState, Tone> = {
  out_of_service: "danger", review: "progress", issues: "warn", repaired: "info", missing: "neutral", partial: "neutral", clean: "ok", not_expected: "neutral",
};
/** States that put a truck in the main table (the rest fold away behind "show clean"). */
export const NEEDS_STATES: readonly BoardState[] = ["out_of_service", "review", "issues", "repaired", "missing"];

/** The one thing to do on a board row. */
export type BoardAction = "review" | "confirm" | "chase" | null;

/**
 * Close note of a defect closed because its walk-around was switched to "missing" after it was reviewed. Marking the
 * video received again and saving reopens those same defects instead of raising new ones.
 */
export const WITHDRAWN_NOTE = "Review withdrawn: video marked missing";

/** How this week's components were marked on the review (GOOD / SOON / NOW / UNSEEN). */
export type BoardMarks = { good: number; soon: number; now: number; unseen: number; total: number };

export function countMarks(ratings: readonly { rating: string }[]): BoardMarks {
  const m: BoardMarks = { good: 0, soon: 0, now: 0, unseen: 0, total: 0 };
  for (const r of ratings) {
    m.total++;
    if (r.rating === "GOOD") m.good++;
    else if (r.rating === "SOON") m.soon++;
    else if (r.rating === "NOW") m.now++;
    else if (r.rating === "UNSEEN") m.unseen++;
  }
  return m;
}

/**
 * The board's counters, per truck and week. A truck can be in more than one:
 *  - sent:        the video is marked received, whatever the marks say.
 *  - nothingSent: marked missing, not marked at all (a truck on the road), or received with every item "not seen".
 *  - review:      received and not reviewed yet, or reviewed with at least one item "not seen" (but not all).
 *  - issues:      reviewed with at least one item "soon" or "now".
 *  - clean:       reviewed with every item "good".
 * "Not seen" together with "soon"/"now" puts the truck in both To review and Open issues. The Today page counts
 * walk-arounds with the same rule.
 */
export type BoardCategories = { sent: boolean; nothingSent: boolean; review: boolean; issues: boolean; clean: boolean };

export function categorize(video: string | null | undefined, reviewed: boolean, marks: BoardMarks, expected: boolean): BoardCategories {
  const received = video === "RECEIVED";
  const rated = reviewed && marks.total > 0;
  const allUnseen = rated && marks.unseen === marks.total;
  return {
    sent: received,
    nothingSent: video === "MISSING" || (!received && expected) || (received && allUnseen),
    review: received && (!reviewed || (rated && marks.unseen > 0 && !allUnseen)),
    issues: received && rated && marks.soon + marks.now > 0,
    clean: received && rated && marks.good === marks.total,
  };
}

/** Board filters (the counters are links to them). */
export const BOARD_FILTERS = ["needs", "missing", "review", "issues", "clean", "all"] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

export function boardHref(p: { week?: string; show?: string; review?: string; saved?: string } = {}) {
  const q = new URLSearchParams();
  if (p.week) q.set("week", p.week);
  if (p.show && p.show !== "needs") q.set("show", p.show);
  if (p.review) q.set("review", p.review);
  if (p.saved) q.set("saved", p.saved);
  const s = q.toString();
  return `/inspections${s ? `?${s}` : ""}`;
}

/** The short message a dispatcher sends when a walk-around video hasn't come in. */
export function chaseMessage(p: { driver?: string | null; unit: string; weekOf: string; due: string; sender?: string | null }) {
  const first = p.driver?.trim().split(/\s+/)[0];
  return [
    `${first ? `Hi ${first}, your` : "Your"} weekly walk-around video for truck ${p.unit} (week of ${p.weekOf}) hasn't come in yet.`,
    `Please record it at your next stop and send it before ${p.due}.`,
    p.sender ? `Thanks, ${p.sender.trim().split(/\s+/)[0]}` : "Thanks",
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Defects list                                                        */
/* ------------------------------------------------------------------ */

export const DEFECT_VIEWS = ["unresolved", "OPEN", "REPAIRED", "CLOSED", "all"] as const;
export type DefectView = (typeof DEFECT_VIEWS)[number];

export function defectsHref(p: Record<string, string | undefined | null> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v && !(k === "status" && v === "unresolved")) q.set(k, v);
  const s = q.toString();
  return `/inspections/defects${s ? `?${s}` : ""}`;
}

/** Link that opens a new repair order for a defect (the shop form may prefill from `defect`). */
export function newRepairHref(d: { id: string; truckId?: string | null; trailerId?: string | null }) {
  const q = new URLSearchParams();
  if (d.truckId) q.set("truck", d.truckId);
  else if (d.trailerId) q.set("trailer", d.trailerId);
  q.set("defect", d.id);
  return `/maintenance/work-orders/new?${q.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Roadside inspections                                                */
/* ------------------------------------------------------------------ */

export const ROADSIDE_RESULT_TONE: Record<string, Tone> = { CLEAN: "ok", VIOLATIONS: "warn", OOS: "danger" };
export const ROADSIDE_STATUS_TONE: Record<string, Tone> = { OPEN: "warn", CORRECTED: "info", CLOSED: "neutral" };
export const roadsideResultLabel = (r: string) => ROADSIDE_RESULT_LABELS[r] ?? humanize(r);
export const roadsideStatusLabel = (s: string) => ROADSIDE_STATUS_LABELS[s] ?? humanize(s);

export const VIOLATION_UNITS = ["DRIVER", "TRUCK", "TRAILER"] as const;
export const VIOLATION_UNIT_LABELS: Record<string, string> = { DRIVER: "Driver", TRUCK: "Truck", TRAILER: "Trailer" };

/** Out of service if any violation put something out of service, violations if any, else clean. */
export function roadsideResult(violations: readonly { oos: boolean }[]): "CLEAN" | "VIOLATIONS" | "OOS" {
  if (violations.some((v) => v.oos)) return "OOS";
  return violations.length ? "VIOLATIONS" : "CLEAN";
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
export const levelShort = (n: number) => `Level ${ROMAN[n - 1] ?? n}`;

export function roadsideHref(p: Record<string, string | undefined | null> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  const s = q.toString();
  return `/inspections/roadside${s ? `?${s}` : ""}`;
}

/** Days FMCSA gives a carrier to certify corrections and return the report. */
export const CORRECTION_DAYS = 15;
