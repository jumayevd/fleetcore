import type { Tone } from "@/components/ui";

/* Pure helpers shared by the finance pages and their client controls (safe on client and server). */

const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Tabs and invoice filters (both live in the URL)                     */
/* ------------------------------------------------------------------ */

export const FINANCE_TABS = ["queue", "invoices", "aging"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
export const TAB_LABELS: Record<FinanceTab, string> = { queue: "Billing queue", invoices: "Invoices", aging: "Receivables aging" };

export const INVOICE_FILTERS = ["open", "overdue", "DRAFT", "SENT", "PAID", "VOID", "all"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export const FILTER_LABELS: Record<InvoiceFilter, string> = {
  open: "Open", overdue: "Overdue", DRAFT: "Draft", SENT: "Sent", PAID: "Paid", VOID: "Void", all: "All",
};
const DEFAULT_FILTER: InvoiceFilter = "open";

export function parseFilter(v: unknown): InvoiceFilter {
  return typeof v === "string" && (INVOICE_FILTERS as readonly string[]).includes(v) ? (v as InvoiceFilter) : DEFAULT_FILTER;
}

/** `?status=` without a tab (dashboard and alert links) means the invoices tab. */
export function parseTab(tab: unknown, status?: unknown): FinanceTab {
  if (typeof tab === "string" && (FINANCE_TABS as readonly string[]).includes(tab)) return tab as FinanceTab;
  return typeof status === "string" && status ? "invoices" : "queue";
}

export function financeHref({ tab, status, page }: { tab?: FinanceTab; status?: InvoiceFilter; page?: number } = {}) {
  const q = new URLSearchParams();
  if (tab && tab !== "queue") q.set("tab", tab);
  if (status && status !== DEFAULT_FILTER) q.set("status", status);
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/finance?${s}` : "/finance";
}

/** Invoices listed per page on the invoices tab. */
export const INVOICE_PAGE_SIZE = 200;

/** Open work sorts by what is due soonest; history by most recent. */
export const invoiceOrder = (filter: InvoiceFilter) => (filter === "open" || filter === "overdue" || filter === "SENT" ? "due" : "recent");

/** `?page=` as a whole number from 1 (anything else is the first page). */
export function parsePage(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/* ------------------------------------------------------------------ */
/* Invoice lifecycle and billing                                       */
/* ------------------------------------------------------------------ */

/** Allowed moves: draft → sent → paid, and draft or sent → void. Paid and void invoices are final. */
export const INVOICE_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["SENT", "VOID"], SENT: ["PAID", "VOID"], PAID: [], VOID: [],
};

/**
 * Documents a load needs before it is billed. A TONU load was never delivered, so there is no proof of
 * delivery to wait for: the rate confirmation is enough. (lib/workflow.ts still asks every load for RC and
 * POD when it stores the billing stage; the billing queue reads documents through this until that changes.)
 */
// One rule for the queue, the load pages and the stored billing stage (src/lib/workflow.ts).
export { requiredDocsFor } from "@/lib/constants";

/** A TONU load, before or after it is invoiced: TONU loads are never stamped delivered. */
export const wasTonu = (l: { status: string; deliveredAt: Date | null }) =>
  l.status === "TONU" || (l.status === "INVOICED" && !l.deliveredAt);

/** When a load became billable: its delivery, or the day the truck was ordered for on a TONU. */
export const billableSince = (l: { status: string; deliveredAt: Date | null; deliveryAt: Date; pickupAt: Date }) =>
  l.deliveredAt ?? (wasTonu(l) ? l.pickupAt : l.deliveryAt);

/* ------------------------------------------------------------------ */
/* Invoice maths                                                       */
/* ------------------------------------------------------------------ */

/** Amount the customer owes: net plus VAT. */
export const invoiceTotal = (i: { amount: number; taxRate: number }) => i.amount * (1 + i.taxRate);

export const isOverdue = (i: { status: string; dueAt: Date }, now = new Date()) => i.status === "SENT" && i.dueAt.getTime() < now.getTime();

/** Whole days past the due date (negative while still within terms). */
export const daysLate = (dueAt: Date, now = new Date()) => Math.floor((now.getTime() - dueAt.getTime()) / DAY);

/** Display value for the status badge: a sent invoice past its due date reads "Overdue". */
export const invoiceBadge = (i: { status: string; dueAt: Date }, now = new Date()) => (isOverdue(i, now) ? "OVERDUE" : i.status);

export const AGING_BUCKETS = [
  { key: "current", label: "Not yet due", short: "Not due" },
  { key: "1-30", label: "1–30 days late", short: "1–30 d" },
  { key: "31-60", label: "31–60 days late", short: "31–60 d" },
  { key: "60+", label: "Over 60 days late", short: "60+ d" },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** The three tones collections work in (a subset of the kit's Tone). */
export type LateTone = Extract<Tone, "neutral" | "warn" | "danger">;

/** Lateness → tone: quiet within terms, caution to 30 days, then a problem. */
export const lateTone = (days: number): LateTone => (days <= 0 ? "neutral" : days <= 30 ? "warn" : "danger");

/** Share of the credit limit tied up in open invoices → tone. */
export const creditTone = (used: number): LateTone => (used >= 1 ? "danger" : used >= 0.75 ? "warn" : "neutral");

/* ------------------------------------------------------------------ */
/* Company letterhead (AppSetting "company.profile")                   */
/* ------------------------------------------------------------------ */

export type Letterhead = {
  legalName: string; brand: string; taxId: string; licenseNumber: string; director: string; phone: string; email: string; address: string;
  bank: { name: string; account: string; mfo: string; swift: string };
  insurance: { carrier: string; policy: string; agent: string };
};

/** Used when the company profile has not been filled in yet, so an invoice never prints with blanks. */
const LETTERHEAD_FALLBACK: Letterhead = {
  legalName: "FleetOps Logistics", brand: "FleetOps", taxId: "", licenseNumber: "", director: "", phone: "", email: "",
  address: "Tashkent, Uzbekistan",
  bank: { name: "", account: "", mfo: "", swift: "" },
  insurance: { carrier: "", policy: "", agent: "" },
};

const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Tolerant parser: malformed or missing JSON falls back field by field. */
export function parseLetterhead(raw: string | null | undefined): Letterhead {
  if (!raw) return LETTERHEAD_FALLBACK;
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return LETTERHEAD_FALLBACK; }
  const bank = (j.bank ?? {}) as Record<string, unknown>;
  const ins = (j.insurance ?? {}) as Record<string, unknown>;
  const f = LETTERHEAD_FALLBACK;
  return {
    legalName: str(j.legalName, f.legalName), brand: str(j.brand, str(j.legalName, f.brand)), taxId: str(j.taxId), licenseNumber: str(j.licenseNumber),
    director: str(j.director), phone: str(j.phone), email: str(j.email), address: str(j.address, f.address),
    bank: { name: str(bank.name), account: str(bank.account), mfo: str(bank.mfo), swift: str(bank.swift) },
    insurance: { carrier: str(ins.carrier), policy: str(ins.policy), agent: str(ins.agent) },
  };
}

export const hasBankDetails = (l: Letterhead) => Boolean(l.bank.name || l.bank.account);
