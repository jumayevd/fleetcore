/** Overview sections a person can show or hide (client-safe: used by the page and the Customize menu). */
export const OVERVIEW_SECTIONS = [
  { key: "numbers", label: "Key numbers", hint: "In transit, pickups, utilization, drivers, revenue" },
  { key: "today", label: "Today", hint: "Pickups in the next 24 h and recent activity" },
  { key: "attention", label: "Needs attention", hint: "Compliance, dispatch, fleet, money and safety items" },
  { key: "fleet", label: "Live fleet", hint: "Map of every truck (fleet counts for other roles)" },
  { key: "billing", label: "Billing", hint: "Missing paperwork, ready to invoice, overdue" },
  { key: "week", label: "This week", hint: "Production against the weekly goal" },
  { key: "performance", label: "Performance", hint: "Monthly chart and key ratios" },
] as const;

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number]["key"];

/** Cookie with the hidden sections, comma separated. Read on the server, so hidden sections aren't even queried. */
export const OVERVIEW_COOKIE = "overview";

export function parseHidden(v: string | undefined | null): Set<OverviewSection> {
  const keys = new Set<string>(OVERVIEW_SECTIONS.map((s) => s.key));
  return new Set((v ?? "").split(",").filter((k): k is OverviewSection => keys.has(k)));
}
