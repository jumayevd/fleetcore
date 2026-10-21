import "server-only";
import { cache } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { receivables } from "@/lib/stats";
import { daysAgo } from "@/lib/format";
import {
  INVOICE_PAGE_SIZE, billableSince, daysLate, invoiceOrder, invoiceTotal, parseLetterhead, requiredDocsFor, type InvoiceFilter, type Letterhead,
} from "./shared";

const COMPANY_PROFILE_KEY = "company.profile";

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

export async function financeKpis(now = new Date()) {
  const monthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  // Unbilled, ready and missing-docs figures come from the billing queue itself (see billingQueueLoads).
  const [ar, paidThisMonth, paidLastMonth, oldestOverdue, overdueCount, paidRecent] = await Promise.all([
    receivables(),
    db.invoice.findMany({ where: { status: "PAID", paidAt: { gte: monthStart } }, select: { amount: true, taxRate: true } }),
    db.invoice.findMany({ where: { status: "PAID", paidAt: { gte: lastMonthStart, lt: monthStart } }, select: { amount: true, taxRate: true } }),
    db.invoice.findFirst({ where: { status: "SENT", dueAt: { lt: now } }, orderBy: { dueAt: "asc" }, select: { id: true, number: true, dueAt: true, customer: { select: { name: true } } } }),
    db.invoice.count({ where: { status: "SENT", dueAt: { lt: now } } }),
    db.invoice.findMany({ where: { status: "PAID", paidAt: { gte: daysAgo(90) } }, select: { issuedAt: true, paidAt: true } }),
  ]);
  const sum = (xs: { amount: number; taxRate: number }[]) => xs.reduce((a, i) => a + invoiceTotal(i), 0);
  const dso = paidRecent.length
    ? Math.round(paidRecent.reduce((a, i) => a + (i.paidAt!.getTime() - i.issuedAt.getTime()) / 86_400_000, 0) / paidRecent.length)
    : null;
  return {
    receivables: ar.total, openCount: ar.count, aging: ar.aging,
    overdue: ar.overdue, overdueCount,
    oldestOverdue: oldestOverdue ? { ...oldestOverdue, days: daysLate(oldestOverdue.dueAt, now) } : null,
    collected: sum(paidThisMonth), collectedCount: paidThisMonth.length, collectedLastMonth: sum(paidLastMonth),
    monthLabel: format(now, "MMMM"), lastMonthShort: format(lastMonthStart, "MMM"),
    dso, dsoSample: paidRecent.length,
  };
}
export type FinanceKpis = Awaited<ReturnType<typeof financeKpis>>;

/* ------------------------------------------------------------------ */
/* Billing queue                                                       */
/* ------------------------------------------------------------------ */

const QUEUE_SELECT = {
  id: true, reference: true, status: true, billingStage: true, rate: true, deliveredAt: true, deliveryAt: true, pickupAt: true, podSignedBy: true,
  originCity: true, destCity: true, customerRef: true,
  customer: { select: { id: true, name: true } },
  broker: { select: { id: true, name: true } },
  driver: { select: { name: true } },
  documents: { select: { kind: true } },
} satisfies Prisma.LoadSelect;

export type QueueLoad = Prisma.LoadGetPayload<{ select: typeof QUEUE_SELECT }> & { missingDocs: string[] };

/**
 * Completed work with no invoice yet (delivered or TONU), split into loads waiting on paperwork and loads
 * ready to bill, longest-waiting first. Split on the documents themselves with the TONU-aware list
 * (requiredDocsFor), so a TONU load with its rate confirmation can be billed without a proof of delivery.
 */
export async function billingQueueLoads() {
  const loads = await db.load.findMany({
    where: { status: { in: ["DELIVERED", "TONU"] }, invoice: null },
    select: QUEUE_SELECT,
  });
  const rows: QueueLoad[] = loads
    .map((l) => {
      const have = new Set(l.documents.map((d) => d.kind));
      return { ...l, missingDocs: requiredDocsFor(l.status).filter((k) => !have.has(k)) };
    })
    .sort((a, b) => billableSince(a).getTime() - billableSince(b).getTime());
  return {
    missing: rows.filter((l) => l.missingDocs.length > 0),
    ready: rows.filter((l) => l.missingDocs.length === 0),
  };
}
export type BillingQueue = Awaited<ReturnType<typeof billingQueueLoads>>;

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

function invoiceWhere(filter: InvoiceFilter, now: Date): Prisma.InvoiceWhereInput {
  switch (filter) {
    case "open": return { status: { in: ["DRAFT", "SENT"] } };
    case "overdue": return { status: "SENT", dueAt: { lt: now } };
    case "all": return {};
    default: return { status: filter };
  }
}

const INVOICE_INCLUDE = {
  customer: { select: { id: true, name: true, kind: true } },
  load: { select: { id: true, reference: true, originCity: true, destCity: true } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/** One page of invoices for a filter (`page` from 1, INVOICE_PAGE_SIZE per page). */
export function invoiceList(filter: InvoiceFilter, now: Date, page = 1) {
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = invoiceOrder(filter) === "due"
    ? [{ dueAt: "asc" }, { number: "asc" }] : [{ issuedAt: "desc" }, { number: "desc" }];
  return db.invoice.findMany({
    where: invoiceWhere(filter, now), orderBy, include: INVOICE_INCLUDE,
    skip: (page - 1) * INVOICE_PAGE_SIZE, take: INVOICE_PAGE_SIZE,
  });
}

export async function invoiceCounts(now: Date): Promise<Record<InvoiceFilter, number>> {
  const [byStatus, overdue] = await Promise.all([
    db.invoice.groupBy({ by: ["status"], _count: true }),
    db.invoice.count({ where: { status: "SENT", dueAt: { lt: now } } }),
  ]);
  const n = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0;
  return {
    open: n("DRAFT") + n("SENT"), overdue, DRAFT: n("DRAFT"), SENT: n("SENT"), PAID: n("PAID"), VOID: n("VOID"),
    all: byStatus.reduce((a, r) => a + r._count, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Aging by customer                                                   */
/* ------------------------------------------------------------------ */

export type CustomerAging = {
  customer: { id: string; name: string; kind: string; paymentTerms: number; creditLimit: number };
  count: number; open: number; overdue: number; overdueCount: number;
  /** Days past due of the most overdue invoice (negative when nothing is late yet). */
  oldestDays: number;
  oldest: { id: string; number: string } | null;
  creditUsed: number;
};

/** Open (sent) invoices rolled up per bill-to party, worst collections first. */
export async function agingByCustomer(now = new Date()): Promise<CustomerAging[]> {
  const open = await db.invoice.findMany({
    where: { status: "SENT" },
    select: { id: true, number: true, amount: true, taxRate: true, dueAt: true, customer: { select: { id: true, name: true, kind: true, paymentTerms: true, creditLimit: true } } },
  });
  const m = new Map<string, CustomerAging>();
  for (const i of open) {
    const row = m.get(i.customer.id) ?? {
      customer: i.customer, count: 0, open: 0, overdue: 0, overdueCount: 0, oldestDays: -Infinity, oldest: null, creditUsed: 0,
    };
    const total = invoiceTotal(i);
    const late = daysLate(i.dueAt, now);
    row.count += 1;
    row.open += total;
    if (late > 0) { row.overdue += total; row.overdueCount += 1; }
    if (late > row.oldestDays) { row.oldestDays = late; row.oldest = { id: i.id, number: i.number }; }
    m.set(i.customer.id, row);
  }
  return [...m.values()]
    .map((r) => ({ ...r, creditUsed: r.customer.creditLimit > 0 ? r.open / r.customer.creditLimit : 0 }))
    .sort((a, b) => b.overdue - a.overdue || b.oldestDays - a.oldestDays || b.open - a.open);
}

/* ------------------------------------------------------------------ */
/* Invoice detail                                                      */
/* ------------------------------------------------------------------ */

/** Cached per request: generateMetadata and the page both read it. */
export const invoiceDetail = cache((id: string) =>
  db.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      load: {
        select: {
          id: true, reference: true, customerRef: true, originName: true, originCity: true, destName: true, destCity: true, commodity: true,
          weightKg: true, pallets: true, distanceKm: true, emptyKm: true, equipment: true, deliveredAt: true, pickupAt: true,
          podSignedBy: true, status: true, driver: { select: { name: true } }, truck: { select: { unitNumber: true } },
          customer: { select: { id: true, name: true } },
        },
      },
    },
  }),
);

/** Letterhead for printed invoices from AppSetting "company.profile", with fallbacks for anything unset. */
export async function getLetterhead(): Promise<Letterhead> {
  const row = await db.appSetting.findUnique({ where: { key: COMPANY_PROFILE_KEY } });
  return parseLetterhead(row?.value);
}
