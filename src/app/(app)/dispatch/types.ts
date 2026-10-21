// Client-safe types and small helpers shared by the dispatch board, its API route and the row menu.
// No server imports here — this file is bundled into the browser.


export type BoardView = "teams" | "flat" | "prebook";

/** How the Status column was obtained for the selected date. */
export type StatusMode = "live" | "history" | "projected";

export type BoardStop = { type: string; name: string; city: string; windowStart: string | null; windowEnd: string | null; status: string };

export type BoardLoad = {
  id: string;
  reference: string;
  status: string;
  customer: string;
  originCity: string;
  destCity: string;
  pickupAt: string;
  deliveryAt: string;
  departedAt: string | null;
  deliveredAt: string | null;
  distanceKm: number;
  /** 0..1 along the route (in transit only). */
  progress: number;
  eta: string | null;
  /** ETA falls after the delivery window. */
  late: boolean;
  /** Not yet departed and the pickup window has passed. */
  latePickup: boolean;
  hasRc: boolean;
  priority: string;
  nextStop: BoardStop | null;
  stopsDone: number;
  stopsTotal: number;
};

export type BoardRow = {
  driver: {
    id: string; name: string; phone: string | null; phone2: string | null; type: string;
    hold: boolean; holdReason: string | null; employment: string;
  };
  team: { id: string; name: string; color: string | null } | null;
  status: string;
  /** ISO time the status became active. */
  statusSince: string;
  statusManual: boolean;
  statusMode: StatusMode;
  truck: { id: string; unitNumber: string; locationName: string | null; fuelPct: number | null; lastPingAt: string | null; speedKmh: number | null } | null;
  trailer: { id: string; unitNumber: string; type: string } | null;
  load: BoardLoad | null;
  /** Dispatched load with a pickup more than 24 h out: reserves the driver without occupying them today (live and upcoming days only). */
  prebooked: { id: string; reference: string; pickupAt: string } | null;
  cell: { color: RowColor | null; note: string | null };
};

/** `dayEnd`: ISO instant the board's calendar day ends in the company timezone. */
export type BoardPayload = { date: string; today: boolean; rows: BoardRow[]; at: string; dayEnd: string };

export type StatusEvent = { id: string; status: string; source: string; note: string | null; user: string | null; at: string };

/* ------------------------------------------------------------------ */
/* Row colours                                                         */
/* ------------------------------------------------------------------ */

export const ROW_COLORS = ["amber", "green", "red", "blue", "violet"] as const;
export type RowColor = (typeof ROW_COLORS)[number];
export const isRowColor = (v: unknown): v is RowColor => typeof v === "string" && (ROW_COLORS as readonly string[]).includes(v);

/** Row colour → soft token (background) and tone (swatch). */
export const ROW_COLOR_BG: Record<RowColor, string> = {
  amber: "var(--accent-soft)", green: "var(--ok-soft)", red: "var(--danger-soft)", blue: "var(--info-soft)", violet: "var(--progress-soft)",
};
export const ROW_COLOR_LABEL: Record<RowColor, string> = { amber: "Amber", green: "Green", red: "Red", blue: "Blue", violet: "Violet" };

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Compact elapsed time: 42m · 16h 4m · 3d 2h. */
export function duration(fromIso: string, now: number) {
  return span(now - new Date(fromIso).getTime());
}

/** Compact time left until an instant (same format as `duration`). */
export function durationUntil(toIso: string, now: number) {
  return span(new Date(toIso).getTime() - now);
}

function span(msIn: number) {
  const ms = Math.max(0, msIn);
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Hours between two instants, one decimal when small. */
export function hoursBetween(aIso: string, bIso: string) {
  const h = (new Date(aIso).getTime() - new Date(bIso).getTime()) / 3_600_000;
  return Math.abs(h) < 10 ? Math.round(h * 10) / 10 : Math.round(h);
}

/** Search haystack for the board filter box. */
export function rowHaystack(r: BoardRow) {
  return [
    r.driver.name, r.driver.phone, r.driver.phone2, r.truck?.unitNumber, r.trailer?.unitNumber, r.team?.name,
    r.load?.reference, r.prebooked?.reference, r.load?.customer, r.load?.originCity, r.load?.destCity, r.load?.nextStop?.city, r.load?.nextStop?.name, r.truck?.locationName,
  ].filter(Boolean).join(" ").toLowerCase();
}
