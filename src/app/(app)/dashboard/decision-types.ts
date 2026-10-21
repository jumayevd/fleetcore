/*
 * What the Today table and the alert bell are made of. Client-safe (no Prisma, no server-only): the server builds the
 * rows in src/lib/alerts.ts, the table on /dashboard filters, searches and pages them in the browser.
 */

export const DECISION_CATEGORIES = ["oil", "shop", "documents", "pti", "drivers", "fleet"] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const DECISION_CATEGORY_LABELS: Record<DecisionCategory, string> = {
  oil: "Oil", shop: "Shop", documents: "Documents", pti: "PTI", drivers: "Drivers", fleet: "Fleet",
};
export const DECISION_CATEGORY_HINTS: Record<DecisionCategory, string> = {
  oil: "Oil changes overdue or due by odometer, and trucks whose reading is too old to tell",
  shop: "Repairs past their promised date, waiting for approval, without an update, or booked and never started",
  documents: "Registration, annual inspection and insurance expired or missing, and other papers about to expire",
  pti: "Defects found on walk-arounds, trucks held out of service, videos missing or waiting for review",
  drivers: "Licences and medicals, drivers on hold, repair charges the driver has not been told about, roadside corrections",
  fleet: "Trucks without a driver, lease mileage caps, trackers that went quiet",
};
export const isDecisionCategory = (v: unknown): v is DecisionCategory =>
  typeof v === "string" && (DECISION_CATEGORIES as readonly string[]).includes(v);

/** urgent: before the next load · high: today · normal: this week. */
export const DECISION_PRIORITIES = ["urgent", "high", "normal"] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];
export const DECISION_PRIORITY_LABELS: Record<DecisionPriority, string> = { urgent: "Now", high: "Today", normal: "This week" };
export const DECISION_PRIORITY_HINTS: Record<DecisionPriority, string> = {
  urgent: "The unit or driver should not run until this is sorted",
  high: "Sort it out today",
  normal: "Plan it this week",
};
export const DECISION_PRIORITY_TONE = { urgent: "danger", high: "warn", normal: "neutral" } as const satisfies Record<DecisionPriority, string>;
export const PRIORITY_RANK: Record<DecisionPriority, number> = { urgent: 0, high: 1, normal: 2 };

export type DecisionLink = { label: string; href: string };

/** One thing that needs a decision, with the one button that does it. Strings are already in company units and time. */
export type Decision = {
  /** Stable key: "oil:<truckId>", "defect:<id>", … */
  key: string;
  category: DecisionCategory;
  priority: DecisionPriority;
  /** The truck, trailer, driver or company it is about. */
  unit: { kind: "truck" | "trailer" | "driver" | "company"; label: string; href: string } | null;
  /** The driver of that unit (or the driver concerned), when there is one. */
  driver: { name: string; href: string } | null;
  /** "Oil change overdue" */
  issue: string;
  /** "4,043 mi over · due at 152,000 mi" */
  detail: string;
  /** What an editor does about it: "Book oil service" → the page or dialog that does it. */
  action: DecisionLink;
  /** Where anyone (view-only included) can look at it. */
  view: DecisionLink;
  /** "open 4 d", "3 d late", "expired 12 d ago" — null when age says nothing. */
  age: string | null;
  /** Epoch ms the clock started (oldest first within a priority). */
  since: number;
};

/** Priority, then age (oldest first), then unit. */
export function sortDecisions(rows: Decision[]) {
  return rows.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.since - b.since
    || (a.unit?.label ?? "").localeCompare(b.unit?.label ?? "", undefined, { numeric: true }));
}
