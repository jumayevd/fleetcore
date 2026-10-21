import type { Tone } from "@/components/ui";
import type { LoadStatus } from "@/lib/constants";

/* Pure helpers shared by the list, board, form and detail (safe on client and server). */

export const BOARD_COLUMNS: LoadStatus[] = ["PLANNED", "ASSIGNED", "IN_TRANSIT", "DELIVERED"];

/** Revenue per km including repositioning (rate / (loaded + empty)). Null when there is no distance. */
export function ratePerKm(rate: number, distanceKm: number, emptyKm = 0): number | null {
  const total = (distanceKm || 0) + (emptyKm || 0);
  return total > 0 ? rate / total : null;
}
export const fmtRpk = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`);

/** Market guide for a lane: distance × 1.6 + 150, rounded to $10. */
export const suggestedRate = (distanceKm: number) => (distanceKm > 0 ? Math.round((distanceKm * 1.6 + 150) / 10) * 10 : null);

export const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", NORMAL: "neutral", HIGH: "warn", URGENT: "danger" };
export const STOP_TONE: Record<string, Tone> = { PENDING: "neutral", ARRIVED: "info", DONE: "ok" };
export const STOP_TYPE_TONE: Record<string, Tone> = { PICKUP: "info", DELIVERY: "accent" };
export const STOP_TYPE_LABEL: Record<string, string> = { PICKUP: "Pickup", DELIVERY: "Delivery" };

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export const EVENT_TABS = [
  { key: "all", label: "All", types: null },
  { key: "status", label: "Status", types: ["STATUS", "ASSIGNED", "CREATED"] },
  { key: "edits", label: "Edits", types: ["EDIT"] },
  { key: "documents", label: "Documents", types: ["DOCUMENT"] },
  { key: "billing", label: "Billing", types: ["BILLING"] },
  { key: "notes", label: "Notes", types: ["NOTE", "CHECK_CALL", "ISSUE"] },
] as const;
export type EventTab = (typeof EVENT_TABS)[number]["key"];

export const EVENT_TONE: Record<string, Tone> = {
  CREATED: "neutral", ASSIGNED: "info", STATUS: "progress", EDIT: "neutral", DOCUMENT: "info", BILLING: "accent",
  NOTE: "neutral", CHECK_CALL: "ok", ISSUE: "danger",
};
export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Created", ASSIGNED: "Assignment", STATUS: "Status", EDIT: "Edit", DOCUMENT: "Document", BILLING: "Billing",
  NOTE: "Note", CHECK_CALL: "Check call", ISSUE: "Issue",
};

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

export type StepState = "done" | "current" | "todo" | "skipped";
export type LoadStep = { key: string; label: string; at: Date | null; state: StepState };
export type Terminal = { status: "CANCELLED" | "TONU"; label: string; at: Date | null; reason: string | null } | null;

const STEP_LABELS = ["Booked", "Dispatched", "At pickup", "In transit", "Delivered", "Invoiced"] as const;

/**
 * Booked → Dispatched → At pickup → In transit → Delivered → Invoiced, with the timestamp each
 * milestone was reached. Cancelled / TONU loads keep the milestones they reached and end in a terminal state.
 */
export function loadSteps(load: {
  status: string; createdAt: Date; departedAt: Date | null; deliveredAt: Date | null;
  stops: { type: string; status: string; arrivedAt: Date | null; seq: number }[];
  events: { type: string; message: string; createdAt: Date }[];
  invoice: { issuedAt: Date } | null;
}): { steps: LoadStep[]; terminal: Terminal } {
  const asc = [...load.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const firstPickup = [...load.stops].sort((a, b) => a.seq - b.seq).find((s) => s.type === "PICKUP");
  const assignedAt = asc.find((e) => e.type === "ASSIGNED")?.createdAt ?? null;
  const atPickupAt = firstPickup?.arrivedAt ?? null;
  const invoicedAt = load.invoice?.issuedAt ?? asc.find((e) => e.type === "STATUS" && /invoice/i.test(e.message))?.createdAt ?? null;
  const at: (Date | null)[] = [load.createdAt, assignedAt, atPickupAt, load.departedAt, load.deliveredAt, invoicedAt];

  const terminalStatus = load.status === "CANCELLED" || load.status === "TONU" ? load.status : null;
  let reached: number;
  switch (load.status) {
    case "PLANNED": reached = 0; break;
    case "ASSIGNED": reached = 1; break;
    case "IN_TRANSIT": reached = firstPickup?.status === "DONE" || load.departedAt ? 3 : 2; break;
    case "DELIVERED": reached = 4; break;
    case "INVOICED": reached = 6; break; // every milestone done
    default: reached = invoicedAt ? 5 : load.deliveredAt ? 4 : load.departedAt ? 3 : atPickupAt ? 2 : assignedAt ? 1 : 0;
  }

  const steps: LoadStep[] = STEP_LABELS.map((label, i) => ({
    key: label, label, at: at[i],
    state: terminalStatus
      ? i <= reached ? "done" : "skipped"
      : i < reached ? "done" : i === reached ? "current" : "todo",
  }));

  let terminal: Terminal = null;
  if (terminalStatus) {
    const ev = [...asc].reverse().find((e) => e.type === "STATUS");
    const reason = ev?.message.includes(" — ") ? ev.message.split(" — ").slice(1).join(" — ") : null;
    terminal = { status: terminalStatus, label: terminalStatus === "TONU" ? "TONU" : "Cancelled", at: ev?.createdAt ?? null, reason };
  }
  return { steps, terminal };
}

/** Delivered after the window, or (in transit) projected to arrive after it. */
export function lateness(load: { deliveryAt: Date; deliveredAt: Date | null }, eta: Date | null): "late" | "eta-late" | null {
  if (load.deliveredAt) return load.deliveredAt > load.deliveryAt ? "late" : null;
  if (eta && eta > load.deliveryAt) return "eta-late";
  return null;
}

/* ------------------------------------------------------------------ */
/* Assignment option shapes (data is loaded server-side in options.ts) */
/* ------------------------------------------------------------------ */

export type Opt = { id: string; label: string; /** Busy on another active load, on hold, on vacation… shown as a quiet "— note" marker. */ note?: string };
export type TruckOpt = Opt & { pairedDriverId: string | null };
export type DriverOpt = Opt & { pairedTruckId: string | null; payPerKm: number; teamId: string | null };
export type TeamOpt = { id: string; name: string; color: string | null };
/** "T-101 · Volvo FH (Rustam) — busy" */
export const optLabel = (o: Opt) => (o.note ? `${o.label} — ${o.note}` : o.label);

/* ------------------------------------------------------------------ */
/* Time helpers (client-safe)                                          */
/* ------------------------------------------------------------------ */

/** "45 min", "3 h 10 min", "2 d 4 h" — for lateness and dwell times. */
export function fmtDuration(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** "02 Oct, 08:00 – 12:00" (same day) or "02 Oct, 08:00 – 03 Oct, 18:00"; "No window" when neither is set. */
export function windowLabel(start: Date | string | null | undefined, end: Date | string | null | undefined) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const dt = (d: Date) => d.toLocaleString("en-GB", { day: "2-digit", month: "short" }).replace(/ /, " ") + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const tm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (s && e) return s.toDateString() === e.toDateString() ? `${dt(s)} – ${tm(e)}` : `${dt(s)} – ${dt(e)}`;
  if (s) return `from ${dt(s)}`;
  if (e) return `by ${dt(e)}`;
  return "No window";
}

/** Arrived (or completed) after the appointment window closed. */
export function stopLateBy(stop: { windowEnd: Date | null; arrivedAt: Date | null; departedAt: Date | null }): number | null {
  const at = stop.arrivedAt ?? stop.departedAt;
  if (!at || !stop.windowEnd) return null;
  const diff = at.getTime() - stop.windowEnd.getTime();
  return diff > 0 ? diff : null;
}

/** Labels for the dispatcher's status buttons; only transitions allowed by LOAD_TRANSITIONS are offered. */
export const TRANSITION_LABEL: Partial<Record<LoadStatus, string>> = {
  IN_TRANSIT: "Depart — picked up",
  DELIVERED: "Confirm delivery",
  INVOICED: "Send to billing",
  PLANNED: "Unassign",
  CANCELLED: "Cancel load",
  TONU: "Truck ordered, not used",
};

/** GPS fix older than 15 minutes (or none) — the marker is drawn faded on the map. */
export const pingStale = (lastPingAt: Date | string | null | undefined, maxAgeMs = 15 * 60_000) =>
  !lastPingAt || Date.now() - new Date(lastPingAt).getTime() > maxAgeMs;

/* ------------------------------------------------------------------ */
/* Imperative action calls (client-safe)                               */
/* ------------------------------------------------------------------ */

/**
 * Error text for an action called imperatively (not through ActionForm). Accepts either a returned `{ error }` or a
 * thrown error. Production builds replace thrown server-action messages with a generic digest text, so there the
 * caller's fallback (which says what to do next) is shown instead of that text.
 */
export function actionError(result: unknown, thrown: unknown, fallback: string): string | null {
  if (result && typeof result === "object" && "error" in result && typeof result.error === "string" && result.error) return result.error;
  if (thrown === undefined) return null;
  if (process.env.NODE_ENV !== "production" && thrown instanceof Error && thrown.message) return thrown.message;
  return fallback;
}
