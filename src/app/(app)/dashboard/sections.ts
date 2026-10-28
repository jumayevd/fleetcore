/**
 * Today sections a person can show or hide (client-safe: used by the page and the Customize menu). The keys are the
 * ones the first overview used, so choices people already made carry over.
 */
export const OVERVIEW_SECTIONS = [
  { key: "numbers", label: "Fleet today", hint: "Oil, walk-arounds, defects, parts, papers, the shop, annual DOT inspections" },
  { key: "attention", label: "Needs a decision today", hint: "Every open item with the one button that sorts it" },
  { key: "today", label: "In the shop", hint: "Units at a shop: stage, promised date, downtime" },
  { key: "costs", label: "This month's spend", hint: "Maintenance and fuel, this month against last" },
  { key: "upcoming", label: "Coming up", hint: "Papers expiring and oil services due in the next 30 days" },
  { key: "fleet", label: "Live fleet", hint: "Map of every truck, with status counts" },
] as const;

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number]["key"];

/** Cookie with the hidden sections, comma separated. Read on the server, so hidden sections aren't even queried. */
export const OVERVIEW_COOKIE = "overview";

/** Unknown keys (sections of an older overview) are dropped. */
export function parseHidden(v: string | undefined | null): Set<OverviewSection> {
  const keys = new Set<string>(OVERVIEW_SECTIONS.map((s) => s.key));
  return new Set((v ?? "").split(",").filter((k): k is OverviewSection => keys.has(k)));
}
