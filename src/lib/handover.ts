/*
 * What goes with a truck when a driver takes it (DriverAssignment.handover). Plain module: the assignment form
 * (client) and the actions (server) read and check the same list.
 */

export const HANDOVER_ITEMS = ["TABLET", "GPS", "ELD", "FUEL_CARD", "TOLL_TAG", "KEYS"] as const;
export type HandoverKey = (typeof HANDOVER_ITEMS)[number] | "OTHER";

export const HANDOVER_LABELS: Record<HandoverKey, string> = {
  TABLET: "Tablet", GPS: "GPS", ELD: "ELD", FUEL_CARD: "Fuel card", TOLL_TAG: "Toll tag", KEYS: "Keys", OTHER: "Other",
};

/** One thing handed over: a standard item, or "OTHER" with its own label; `ref` is a serial, model or tag number. */
export type HandoverItem = { item: HandoverKey; label?: string; ref?: string };

const MAX_ITEMS = 20;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "");

/** Read a handover list from the form (JSON) or the database, dropping anything malformed. */
export function parseHandover(raw: unknown): HandoverItem[] {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const out: HandoverItem[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const item = (HANDOVER_ITEMS as readonly string[]).includes(String(o.item)) ? (o.item as HandoverKey) : o.item === "OTHER" ? "OTHER" : null;
    if (!item) continue;
    const label = item === "OTHER" ? clip(o.label, 60) : "";
    if (item === "OTHER" && !label) continue;
    const key = item === "OTHER" ? `OTHER:${label.toLowerCase()}` : item;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = clip(o.ref, 80);
    out.push({ item, ...(label ? { label } : {}), ...(ref ? { ref } : {}) });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const handoverName = (h: HandoverItem) => (h.item === "OTHER" ? h.label ?? "Other" : HANDOVER_LABELS[h.item]);
