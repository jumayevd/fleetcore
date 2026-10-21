/*
 * Repair orders and oil service: plain values and rules shared by the shop pages, the truck / trailer page components
 * and the server actions. Client-safe (no Prisma, no server-only imports).
 */
import { PAYER_LABELS, REPAIR_STAGE_LABELS, REPAIR_SYSTEM_LABELS, REPAIR_TYPE_LABELS, humanize } from "@/lib/constants";
import type { Tone } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** How a repair order's status reads in the shop (WorkOrder.status values). */
export const REPAIR_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft", OPEN: "Scheduled", IN_PROGRESS: "In the shop", DONE: "Completed", CANCELLED: "Cancelled",
};
const REPAIR_STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", OPEN: "info", IN_PROGRESS: "warn", DONE: "ok", CANCELLED: "neutral" };

type StatusLike = { status: string; voidedAt?: Date | string | null };
export const repairStatusLabel = (w: StatusLike) => (w.voidedAt ? "Void" : REPAIR_STATUS_LABELS[w.status] ?? humanize(w.status));
export const repairStatusTone = (w: StatusLike): Tone => (w.voidedAt ? "neutral" : REPAIR_STATUS_TONE[w.status] ?? "neutral");

/** Statuses of work that is still going on (booked or in the shop). */
export const ACTIVE_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS"] as const;
export const isActive = (status: string) => (ACTIVE_STATUSES as readonly string[]).includes(status);

/** The three ways a repair order can start on the form. */
export const FORM_STATUSES = [
  { value: "OPEN", label: "Scheduled into a shop", hint: "Booked. The unit stays in service until it goes in." },
  { value: "IN_PROGRESS", label: "In the shop", hint: "The unit is off the road and the downtime clock runs." },
  { value: "DONE", label: "Completed", hint: "Back in service. Needs what was done and, for cost, the invoice." },
] as const;

/* ------------------------------------------------------------------ */
/* Repair types and the services they reset                            */
/* ------------------------------------------------------------------ */

/** Older reports group by WorkOrder.category; every repair type maps to one so those keep adding up. */
const CATEGORY_FOR_TYPE: Record<string, string> = {
  OIL_CHANGE: "PM", PM_INSPECTION: "PM", DOT_INSPECTION: "INSPECTION", ENGINE: "ENGINE", INJECTOR: "ENGINE", DPF: "ENGINE",
  ELECTRICAL: "ELECTRICAL", COMPUTER: "ELECTRICAL", BODY: "BODY", FRAME: "BODY", ACCIDENT: "BODY", TIRES: "TIRES",
  STEER: "OTHER", REPAIR: "OTHER", OTHER: "OTHER",
};
export const categoryForRepairType = (t: string) => CATEGORY_FOR_TYPE[t] ?? "OTHER";

/** For callers that still send a category (the quick form on the truck page). */
const TYPE_FOR_CATEGORY: Record<string, string> = {
  PM: "OIL_CHANGE", INSPECTION: "DOT_INSPECTION", ENGINE: "ENGINE", COOLING: "ENGINE", ELECTRICAL: "ELECTRICAL", BODY: "BODY",
  TIRES: "TIRES", BRAKES: "REPAIR", TOWING: "OTHER", OTHER: "REPAIR",
};
export const repairTypeForCategory = (c: string) => TYPE_FOR_CATEGORY[c] ?? "REPAIR";

type TypeLike = { repairType: string; category?: string | null };
/** Completing it resets the oil interval. Rows from before repair types count by their old PM category. */
export const resetsOil = (w: TypeLike) => w.repairType === "OIL_CHANGE" || (w.repairType === "REPAIR" && w.category === "PM");
/** Completing it moves the annual DOT inspection a year on. */
export const resetsInspection = (w: TypeLike) => w.repairType === "DOT_INSPECTION" || (w.repairType === "REPAIR" && w.category === "INSPECTION");
/** Repair types that count as "booked" on the oil board. */
export const OIL_SERVICE_TYPES = ["OIL_CHANGE", "PM_INSPECTION"] as const;

export const repairTypeLabel = (t: string | null | undefined) => (t ? REPAIR_TYPE_LABELS[t] ?? humanize(t) : "—");
export const systemLabel = (s: string) => REPAIR_SYSTEM_LABELS[s] ?? humanize(s);
export const stageLabel = (s: string | null | undefined) => (s ? REPAIR_STAGE_LABELS[s] ?? humanize(s) : null);
export const payerLabel = (p: string) => PAYER_LABELS[p] ?? humanize(p);

/** Default system for the first line of a new repair of this type. */
export const SYSTEM_FOR_TYPE: Record<string, string> = {
  OIL_CHANGE: "PM", PM_INSPECTION: "PM", DOT_INSPECTION: "OTHER", ENGINE: "ENGINE", INJECTOR: "ENGINE", DPF: "EXHAUST",
  ELECTRICAL: "ELECTRICAL", COMPUTER: "ELECTRICAL", BODY: "BODY", FRAME: "BODY", ACCIDENT: "BODY", TIRES: "TIRES",
  STEER: "SUSPENSION", REPAIR: "OTHER", OTHER: "OTHER",
};

/* ------------------------------------------------------------------ */
/* Payer                                                               */
/* ------------------------------------------------------------------ */

type PayerLike = { payer: string; driverInformedAt?: Date | string | null; voidedAt?: Date | string | null; status: string };
/** Charged to a driver who has not been told yet: nothing comes off their pay until they are. */
export const driverNotTold = (w: PayerLike) => w.payer === "DRIVER" && !w.driverInformedAt && !w.voidedAt && w.status !== "CANCELLED";

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

export type LineValue = { system: string; work: string; amount: number };

/** "Brakes: replaced pads · Tires: 2 drive tires +1 more" */
export function linesSummary(lines: { system: string; work: string }[], max = 2) {
  if (!lines.length) return "";
  const shown = lines.slice(0, max).map((l) => l.work);
  const more = lines.length - max;
  return `${shown.join(" · ")}${more > 0 ? ` +${more} more` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "12d 9h" · "5h 20m" · "35m" */
export function durationText(ms: number) {
  const v = Math.max(0, ms);
  if (v >= DAY) {
    const d = Math.floor(v / DAY);
    const h = Math.floor((v % DAY) / HOUR);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (v >= HOUR) {
    const h = Math.floor(v / HOUR);
    const m = Math.floor((v % HOUR) / MIN);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(v / MIN)}m`;
}

/** Time off the road: from in-shop to back-in-service, or to now while it is still in. */
export function downtime(w: { inAt: Date | string | null; outAt: Date | string | null; status: string }, now = Date.now()) {
  if (!w.inAt) return null;
  const start = new Date(w.inAt).getTime();
  const running = !w.outAt && w.status === "IN_PROGRESS";
  const end = w.outAt ? new Date(w.outAt).getTime() : running ? now : null;
  if (end == null) return null;
  return { ms: end - start, running, text: durationText(end - start) };
}

/** Days in the shop → tone: quiet for a week, caution to three weeks, then a problem. */
export const downtimeTone = (ms: number): Tone => (ms > 21 * DAY ? "danger" : ms > 7 * DAY ? "warn" : "neutral");

/* ------------------------------------------------------------------ */
/* Oil change checklist                                                */
/* ------------------------------------------------------------------ */

/** What a PM visit can include. Oil & filter is what resets the oil interval. */
export const OIL_CHECKLIST = [
  { key: "OIL_FILTER", label: "Engine oil & filter", work: "Engine oil and filter changed", required: true },
  { key: "FUEL_FILTERS", label: "Fuel filters", work: "Fuel filters replaced" },
  { key: "FUEL_SEPARATOR", label: "Fuel / water separator", work: "Fuel / water separator replaced" },
  { key: "AIR_FILTER", label: "Air filter", work: "Air filter replaced" },
  { key: "CABIN_FILTER", label: "Cabin filter", work: "Cabin filter replaced" },
  { key: "FIFTH_WHEEL", label: "5th wheel greased", work: "5th wheel greased" },
] as const;

/* ------------------------------------------------------------------ */
/* Vendors                                                             */
/* ------------------------------------------------------------------ */

/** What the vendor picker needs about a vendor. */
export type VendorOption = { id: string; name: string; type: string; city: string | null; phone: string | null; active: boolean };

/** A "shop" named only by a street address ("1234 Industrial Pkwy"): worth giving a proper name. */
export const looksLikeAddress = (name: string) => /^\d+\s+\S+/.test(name.trim());

/** Case- and space-insensitive key to match a typed shop name against a vendor. */
export const vendorKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
