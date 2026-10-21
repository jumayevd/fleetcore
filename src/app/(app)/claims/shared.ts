import type { Tone } from "@/components/ui";
import { CLAIM_STATUSES } from "@/lib/constants";

/* Pure helpers shared by the claims list, analytics, form, detail page and client controls (safe on client and server). */

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  REPORTED: "Reported",
  UNDER_REVIEW: "Under review",
  DOCS_COLLECTED: "Docs collected",
  SUBMITTED: "Submitted",
  NEGOTIATION: "Negotiation",
  APPROVED: "Approved",
  DENIED: "Denied",
  PAID: "Paid",
  CLOSED: "Closed",
  DISPUTED: "Disputed",
  LITIGATION: "Litigation",
};
export const claimStatusLabel = (s: string) => CLAIM_STATUS_LABELS[s as ClaimStatus] ?? s;

export const CLAIM_SEVERITY_LABELS: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
export const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Lifecycle. Reported → under review → docs collected → submitted → negotiation → approved | denied.
 * Approved → paid → closed. Denied → closed | disputed. Disputed → negotiation | litigation. Litigation → closed.
 */
const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  REPORTED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["DOCS_COLLECTED"],
  DOCS_COLLECTED: ["SUBMITTED"],
  SUBMITTED: ["NEGOTIATION"],
  NEGOTIATION: ["APPROVED", "DENIED"],
  APPROVED: ["PAID"],
  DENIED: ["CLOSED", "DISPUTED"],
  PAID: ["CLOSED"],
  CLOSED: [],
  DISPUTED: ["NEGOTIATION", "LITIGATION"],
  LITIGATION: ["CLOSED"],
};
export const allowedClaimTransitions = (from: string): ClaimStatus[] => CLAIM_TRANSITIONS[from as ClaimStatus] ?? [];

/** Statuses that stamp `closedAt` (the claim leaves the open book). */
export const CLAIM_CLOSING_STATUSES: readonly ClaimStatus[] = ["PAID", "CLOSED", "DENIED"];
export const isClosingStatus = (s: string) => (CLAIM_CLOSING_STATUSES as readonly string[]).includes(s);

/**
 * Where a claim stands. `open` is the open book (CLAIM_OPEN_STATUSES — still being worked, what the
 * KPIs, nav badge and alerts count). `awaiting` is approved but not paid yet: off the open book, but
 * not closed — money is still due and nothing has been received. `closed` is paid, closed or denied
 * (the statuses that stamp `closedAt`).
 */
export type ClaimPhase = "open" | "awaiting" | "closed";
export function claimPhase(status: string): ClaimPhase {
  if (isClosingStatus(status)) return "closed";
  return status === "APPROVED" ? "awaiting" : "open";
}

/** Verb-first button labels for the status controls, plus the one-line consequence shown under each. */
export const TRANSITION_LABEL: Record<ClaimStatus, string> = {
  REPORTED: "Reopen as reported",
  UNDER_REVIEW: "Start review",
  DOCS_COLLECTED: "Mark docs collected",
  SUBMITTED: "Submit to insurer",
  NEGOTIATION: "Open negotiation",
  APPROVED: "Approve",
  DENIED: "Deny",
  PAID: "Record payment",
  CLOSED: "Close claim",
  DISPUTED: "Dispute decision",
  LITIGATION: "Escalate to litigation",
};
export const TRANSITION_HINT: Record<ClaimStatus, string> = {
  REPORTED: "Puts the claim back at the start of the process.",
  UNDER_REVIEW: "Someone owns the claim and is gathering the facts.",
  DOCS_COLLECTED: "Photos, statements and estimates are on file — the pack is ready to send.",
  SUBMITTED: "The claim pack has gone to the insurer, broker or counterparty.",
  NEGOTIATION: "Amounts and liability are being discussed.",
  APPROVED: "The counterparty agreed to pay. Enter the agreed amount.",
  DENIED: "The claim was rejected. It can still be disputed.",
  PAID: "Money received. Enter the settled amount; the claim closes.",
  CLOSED: "Nothing more to do. The claim leaves the open book.",
  DISPUTED: "Reopens the claim to challenge the denial.",
  LITIGATION: "Legal proceedings started — reserve the full claimed amount.",
};

/** Transitions that want a settled amount (approved / paid). */
export const WANTS_AMOUNT: readonly ClaimStatus[] = ["APPROVED", "PAID"];

export const FAULT_TONE: Record<string, Tone> = { OURS: "danger", THIRD_PARTY: "info", SHARED: "warn", UNKNOWN: "neutral" };

/** Days the claim has been (or was) open: since creation, until it closed. */
export function daysOpen(c: { createdAt: Date | string; closedAt: Date | string | null }, now = Date.now()) {
  const end = c.closedAt ? new Date(c.closedAt).getTime() : now;
  return Math.max(0, Math.round((end - new Date(c.createdAt).getTime()) / 86_400_000));
}

/** Age tone for an open-book claim: quiet under 14 days, caution after, problem after 45 (matches the dashboard alert thresholds). */
export function ageTone(days: number, open: boolean): Tone {
  if (!open) return "neutral";
  if (days > 45) return "danger";
  if (days > 14) return "warn";
  return "neutral";
}

/** Settled as a share of what was claimed; null when nothing was claimed or settled yet. */
export function recoveryPct(amountClaimed: number, amountSettled: number | null | undefined) {
  if (amountSettled == null || !amountClaimed) return null;
  return Math.round((amountSettled / amountClaimed) * 100);
}

export const CLAIM_TYPE_DOC_HINT: Record<string, string> = {
  CARGO_DAMAGE: "Usually needs photos at unloading, the BOL with exceptions noted and a repair or replacement estimate.",
  CARGO_LOSS: "Usually needs the BOL, the consignee's shortage report and the commercial invoice for the missing goods.",
  LATE_CARGO: "Usually needs the rate confirmation (delivery window), check-call history and the consignee's late-fee notice.",
  OSD: "Over, short and damaged: count discrepancy against the BOL, photos and the consignee's OS&D report.",
  ACCIDENT: "Usually needs the police report, driver statement, photos of all vehicles and third-party details.",
  EQUIPMENT_DAMAGE: "Usually needs photos, a repair estimate and, if a third party caused it, their details.",
  INJURY: "Usually needs the incident report, medical paperwork and witness statements. Treat as critical.",
  OTHER: "Attach whatever supports the claim: correspondence, receipts, photos.",
};

/* ------------------------------------------------------------------ */
/* Form option shapes (data is loaded server-side in options.ts)       */
/* ------------------------------------------------------------------ */

export type ComboOption = { id: string; label: string; hint?: string; /** Extra text the search matches on. */ keywords?: string };
export type LoadOption = ComboOption & {
  driverId: string | null; truckId: string | null; trailerId: string | null; customerId: string;
  /** Delivery place — a sensible default for the incident location. */
  place: string;
  /** ISO date of delivery, or null when not delivered. */
  deliveredAt: string | null;
};
export type PersonOption = { id: string; label: string; hint?: string };

/* ------------------------------------------------------------------ */
/* URL state (client-safe)                                             */
/* ------------------------------------------------------------------ */

export const CLAIM_TABS = ["table", "analytics"] as const;
export type ClaimTab = (typeof CLAIM_TABS)[number];

/** `status` accepts a lifecycle status or one of these groups. */
export const STATUS_GROUPS = ["open", "closed"] as const;

export type ClaimFilters = {
  tab: ClaimTab;
  type?: string;
  status?: string;
  severity?: string;
  fault?: string;
  q: string;
};

/** `/claims?…` with the current filters, patched. Pass `undefined` in the patch to drop a key. */
export function claimsHref(f: Partial<ClaimFilters>, patch: Partial<Record<keyof ClaimFilters, string | undefined>> = {}) {
  const merged: Record<string, string | undefined> = {
    tab: f.tab === "analytics" ? "analytics" : undefined, type: f.type, status: f.status, severity: f.severity, fault: f.fault, q: f.q || undefined, ...patch,
  };
  if (merged.tab === "table") merged.tab = undefined;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/claims?${s}` : "/claims";
}

export const hasClaimFilters = (f: ClaimFilters) => Boolean(f.type || f.status || f.severity || f.fault || f.q);


/** Everything the claim form's selects need (loaded server-side in options.ts). */
export type ClaimFormOptions = {
  loads: LoadOption[];
  drivers: ComboOption[];
  trucks: ComboOption[];
  trailers: ComboOption[];
  customers: ComboOption[];
  assignees: PersonOption[];
};

/** Form defaults. Dates arrive pre-formatted for <input type="datetime-local"> so no Date crosses the RSC boundary. */
export type ClaimDefaults = Partial<{
  type: string; severity: string; fault: string; status: string;
  incidentAt: string | null; location: string | null; description: string | null;
  amountClaimed: number | null; amountSettled: number | null;
  loadId: string | null; driverId: string | null; truckId: string | null; trailerId: string | null; customerId: string | null; assignedToId: string | null;
}>;
