import "server-only";
import { db, rootDb } from "@/lib/db";
import { kmDriven } from "@/lib/mileage";
import { fromZoned, zonedParts, type Formatter } from "@/lib/locale";

/* ------------------------------------------------------------------ */
/* This month's spend (money.view only)                                */
/* ------------------------------------------------------------------ */

export type SpendMonth = {
  /** "October" */
  label: string;
  /** Completed repairs by completion date: the invoice total, else the job cost. */
  maintenance: number;
  fuel: number;
  total: number;
  /** Part of `maintenance` charged to drivers. */
  driverCharges: number;
  /** Distance driven, from odometer readings (company unit). */
  distance: number;
};

/**
 * Maintenance and fuel for this calendar month so far and for all of last month, with month boundaries in the company's
 * time zone. Voided repairs never count.
 */
export async function monthSpend(f: Formatter, now: Date) {
  const p = zonedParts(now, f.tz);
  const thisStart = fromZoned(p.y, p.m, 1, 0, 0, f.tz);
  const lastStart = p.m === 1 ? fromZoned(p.y - 1, 12, 1, 0, 0, f.tz) : fromZoned(p.y, p.m - 1, 1, 0, 0, f.tz);
  const [work, fuel, distThis, distLast] = await Promise.all([
    db.workOrder.findMany({
      where: { status: "DONE", voidedAt: null, completedAt: { gte: lastStart, lte: now } },
      select: { completedAt: true, cost: true, laborCost: true, partsCost: true, invoiceTotal: true, payer: true },
    }),
    db.fuelLog.findMany({ where: { date: { gte: lastStart, lte: now } }, select: { date: true, cost: true } }),
    kmDriven(thisStart, now),
    kmDriven(lastStart, thisStart),
  ]);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: f.tz });
  const blank = (start: Date, distance: number): SpendMonth => ({ label: month.format(start), maintenance: 0, fuel: 0, total: 0, driverCharges: 0, distance });
  const cur = blank(thisStart, distThis.total);
  const prev = blank(lastStart, distLast.total);
  const bucket = (d: Date) => (d >= thisStart ? cur : prev);
  for (const w of work) {
    if (!w.completedAt) continue;
    // `invoiceTotal` is what the shop billed; older jobs only carry cost, or labour and parts.
    const amount = w.invoiceTotal ?? (w.cost || w.laborCost + w.partsCost);
    const b = bucket(w.completedAt);
    b.maintenance += amount;
    if (w.payer === "DRIVER") b.driverCharges += amount;
  }
  for (const x of fuel) bucket(x.date).fuel += x.cost;
  for (const b of [cur, prev]) b.total = b.maintenance + b.fuel;
  return { thisMonth: cur, lastMonth: prev, thisStart };
}
export type MonthSpend = Awaited<ReturnType<typeof monthSpend>>;

/* ------------------------------------------------------------------ */
/* Getting started                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a new company has set up so far. Members and invites are account tables (not company-scoped by `db`), so they
 * go through rootDb with the company id spelled out.
 */
export async function setupProgress(companyId: string) {
  const [trucks, trailers, drivers, companyDocs, members, invites] = await Promise.all([
    db.truck.count(),
    db.trailer.count(),
    db.driver.count(),
    db.document.count({ where: { isCompany: true } }),
    rootDb.membership.count({ where: { companyId, active: true } }),
    rootDb.invite.count({ where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { trucks, trailers, drivers, companyDocs, members, invites };
}
export type SetupProgress = Awaited<ReturnType<typeof setupProgress>>;
