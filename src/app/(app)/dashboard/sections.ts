/** Overview sections a person can show or hide (client-safe: used by the page and the Customize menu). */
export const OVERVIEW_SECTIONS = [
  { key: "numbers", label: "Key numbers", hint: "Trucks available, in shop, PM, paperwork, drivers, work orders" },
  { key: "today", label: "Today in the shop", hint: "Work in progress, booked for today, overdue" },
  { key: "fleet", label: "Live fleet", hint: "Map of every truck, with status counts" },
  { key: "attention", label: "Needs attention", hint: "Compliance, maintenance, drivers and fleet items" },
  { key: "upcoming", label: "Coming up", hint: "Expiries and PM due in the next 30 days" },
  { key: "costs", label: "Costs", hint: "Maintenance and fuel spend by month, cost per km" },
] as const;

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number]["key"];

/** Cookie with the hidden sections, comma separated. Read on the server, so hidden sections aren't even queried. */
export const OVERVIEW_COOKIE = "overview";

/** Unknown keys (sections of an older overview) are dropped. */
export function parseHidden(v: string | undefined | null): Set<OverviewSection> {
  const keys = new Set<string>(OVERVIEW_SECTIONS.map((s) => s.key));
  return new Set((v ?? "").split(",").filter((k): k is OverviewSection => keys.has(k)));
}
