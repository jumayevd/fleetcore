import "server-only";
import { format } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { maintenanceSummary, monthlyFinancials } from "@/lib/stats";
import { CLAIM_OPEN_STATUSES, CLAIM_TYPE_LABELS, EQUIPMENT_LABELS, OWNERSHIP_LABELS } from "@/lib/constants";
import { PERIODS, deltaPct, pct, periodRange, ratio, type PeriodKey } from "./shared";

const COMPLETED = ["DELIVERED", "INVOICED"];
const DAY = 86_400_000;

const LOAD_SELECT = {
  id: true, reference: true, customerId: true, brokerId: true, driverId: true, truckId: true, equipment: true,
  originCity: true, destCity: true, rate: true, driverPay: true, fuelCost: true, otherCost: true, distanceKm: true, emptyKm: true,
  deliveredAt: true, deliveryAt: true,
} satisfies Prisma.LoadSelect;
type L = Prisma.LoadGetPayload<{ select: typeof LOAD_SELECT }>;

const directCost = (l: L) => l.driverPay + l.fuelCost + l.otherCost;
const onTime = (l: L) => !!l.deliveredAt && l.deliveredAt <= l.deliveryAt;
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

function groupBy<K>(xs: L[], key: (l: L) => K | null | undefined) {
  const m = new Map<K, L[]>();
  for (const l of xs) {
    const k = key(l);
    if (k == null) continue;
    const arr = m.get(k);
    if (arr) arr.push(l); else m.set(k, [l]);
  }
  return m;
}

/** Totals for a set of loads (period KPIs and their previous-period comparison). */
function totals(xs: L[]) {
  const revenue = sum(xs, (l) => l.rate);
  const cost = sum(xs, directCost);
  const loaded = sum(xs, (l) => l.distanceKm);
  const empty = sum(xs, (l) => l.emptyKm);
  const onTimeCount = xs.filter(onTime).length;
  return {
    loads: xs.length, revenue, cost, margin: revenue - cost, marginPct: pct(revenue - cost, revenue),
    loadedKm: loaded, emptyKm: empty, km: loaded + empty,
    perKm: ratio(revenue, loaded + empty),
    onTime: onTimeCount,
    onTimePct: pct(onTimeCount, xs.length),
    emptyPct: pct(empty, loaded + empty),
  };
}

export type SeriesPoint = { month: string; revenue: number; cost: number; loads: number; onTimePct: number; emptyPct: number };
export type LaneRow = { lane: string; origin: string; dest: string; loads: number; km: number; emptyKm: number; revenue: number; cost: number; margin: number; marginPct: number; perKm: number | null; emptyPct: number };
export type DriverRow = { id: string; name: string; type: string; loads: number; km: number; emptyKm: number; onTimePct: number; revenue: number; earnings: number; score: number };
export type TruckRow = { id: string; unit: string; model: string; ownership: string; loads: number; km: number; revenue: number; workOrders: number; workOrderCost: number; costPerKm: number | null; perKm: number | null };
export type ClaimRow = { type: string; label: string; count: number; open: number; claimed: number; settled: number };

/** Weekly buckets from `from` to `to` (7-day steps; the last one is partial). */
function weeklySeries(loads: L[], from: Date, to: Date): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += 7 * DAY) {
    const end = Math.min(start + 7 * DAY, to.getTime());
    const xs = loads.filter((l) => l.deliveredAt && l.deliveredAt.getTime() >= start && l.deliveredAt.getTime() < end);
    const t = totals(xs);
    out.push({ month: format(new Date(start), "d MMM"), revenue: Math.round(t.revenue), cost: Math.round(t.cost), loads: t.loads, onTimePct: t.onTimePct, emptyPct: t.emptyPct });
  }
  return out;
}

export async function reportData(period: PeriodKey, now = new Date()) {
  const range = periodRange(period, now);
  const inRange = (from: Date, to: Date): Prisma.LoadWhereInput => ({ status: { in: COMPLETED }, deliveredAt: { gte: from, lt: to } });

  const [loads, prevLoads, maint, claims, trucks, drivers, customers, monthly] = await Promise.all([
    db.load.findMany({ where: inRange(range.from, range.to), select: LOAD_SELECT }),
    db.load.findMany({ where: inRange(range.prevFrom, range.prevTo), select: LOAD_SELECT }),
    maintenanceSummary(range.from, range.to),
    db.claim.findMany({ where: { incidentAt: { gte: range.from, lt: range.to } }, select: { type: true, status: true, amountClaimed: true, amountSettled: true } }),
    db.truck.findMany({ select: { id: true, unitNumber: true, make: true, model: true, ownership: true } }),
    db.driver.findMany({ select: { id: true, name: true, type: true, score: true } }),
    db.customer.findMany({ select: { id: true, name: true, kind: true } }),
    PERIODS[period].months ? monthlyFinancials(PERIODS[period].months) : Promise.resolve(null),
  ]);

  const cur = totals(loads);
  const prev = totals(prevLoads);

  // Claims: settled where known, otherwise the amount claimed (open exposure); denied claims cost nothing.
  const openClaims = claims.filter((c) => (CLAIM_OPEN_STATUSES as readonly string[]).includes(c.status));
  const claimsCost = sum(claims.filter((c) => c.status !== "DENIED"), (c) => c.amountSettled ?? c.amountClaimed);
  const claimsSettled = sum(claims, (c) => c.amountSettled ?? 0);

  const kpis = {
    ...cur,
    revenueDelta: deltaPct(cur.revenue, prev.revenue),
    marginDelta: prevLoads.length ? cur.marginPct - prev.marginPct : null,
    loadsDelta: deltaPct(cur.loads, prev.loads),
    kmDelta: deltaPct(cur.km, prev.km),
    perKmPrev: prev.perKm,
    onTimeDelta: prevLoads.length ? cur.onTimePct - prev.onTimePct : null,
    emptyDelta: prevLoads.length ? cur.emptyPct - prev.emptyPct : null,
    claimsCost, claimsSettled, claimsCount: claims.length, claimsOpen: openClaims.length,
    claimsExposure: sum(openClaims, (c) => c.amountClaimed),
  };

  // Series for the trend charts: calendar months from stats (same numbers as the dashboard) or weekly buckets.
  const seriesAll: SeriesPoint[] = monthly
    ? monthly.map((m) => ({ month: m.month, revenue: m.revenue, cost: m.cost, loads: m.loads, onTimePct: m.onTimePct, emptyPct: m.emptyPct }))
    : weeklySeries(loads, range.from, range.to);
  // A bucket that has just started with nothing delivered yet would drag every line to zero at the right edge.
  const series = seriesAll.length > 1 && seriesAll[seriesAll.length - 1].loads === 0 ? seriesAll.slice(0, -1) : seriesAll;
  const trimmedBucket = series.length < seriesAll.length ? seriesAll[seriesAll.length - 1].month : null;

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const byCustomer = [...groupBy(loads, (l) => l.customerId)]
    .map(([id, xs]) => ({ id, name: customerName.get(id) ?? "Unknown customer", loads: xs.length, revenue: Math.round(sum(xs, (l) => l.rate)) }))
    .sort((a, b) => b.revenue - a.revenue);

  const viaBroker = loads.filter((l) => l.brokerId);
  const split = [
    { name: "Direct", value: Math.round(sum(loads.filter((l) => !l.brokerId), (l) => l.rate)) },
    { name: "Via broker", value: Math.round(sum(viaBroker, (l) => l.rate)) },
  ];

  const byEquipment = [...groupBy(loads, (l) => l.equipment)]
    .map(([e, xs]) => ({ name: EQUIPMENT_LABELS[e] ?? e, value: xs.length }))
    .sort((a, b) => b.value - a.value);

  const lanes: LaneRow[] = [...groupBy(loads, (l) => `${l.originCity} → ${l.destCity}`)]
    .map(([lane, xs]) => {
      const t = totals(xs);
      const [origin, dest] = lane.split(" → ");
      return { lane, origin, dest, loads: t.loads, km: t.km, emptyKm: t.emptyKm, revenue: t.revenue, cost: t.cost, margin: t.margin, marginPct: t.marginPct, perKm: t.perKm, emptyPct: t.emptyPct };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const driverRows: DriverRow[] = [...groupBy(loads, (l) => l.driverId)]
    .map(([id, xs]) => {
      const d = driverById.get(id);
      const t = totals(xs);
      return { id, name: d?.name ?? "Former driver", type: d?.type ?? "COMPANY", loads: t.loads, km: t.km, emptyKm: t.emptyKm, onTimePct: t.onTimePct, revenue: t.revenue, earnings: sum(xs, (l) => l.driverPay), score: d?.score ?? 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const truckById = new Map(trucks.map((t) => [t.id, t]));
  const woByUnit = new Map(maint.perUnit.map((u) => [u.name, u]));
  const truckRows: TruckRow[] = [...groupBy(loads, (l) => l.truckId)]
    .map(([id, xs]) => {
      const tr = truckById.get(id);
      const t = totals(xs);
      const wo = tr ? woByUnit.get(tr.unitNumber) : undefined;
      const woCost = wo?.cost ?? 0;
      return {
        id, unit: tr?.unitNumber ?? "Retired unit", model: tr ? `${tr.make} ${tr.model}` : "", ownership: tr ? OWNERSHIP_LABELS[tr.ownership] ?? tr.ownership : "—",
        loads: t.loads, km: t.km, revenue: t.revenue, workOrders: wo?.count ?? 0, workOrderCost: woCost,
        costPerKm: ratio(t.cost + woCost, t.km), perKm: t.perKm,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const claimRows: ClaimRow[] = [...claims.reduce((m, c) => {
    const r = m.get(c.type) ?? { type: c.type, label: CLAIM_TYPE_LABELS[c.type] ?? c.type, count: 0, open: 0, claimed: 0, settled: 0 };
    r.count += 1;
    if ((CLAIM_OPEN_STATUSES as readonly string[]).includes(c.status)) r.open += 1;
    r.claimed += c.amountClaimed;
    r.settled += c.amountSettled ?? 0;
    return m.set(c.type, r);
  }, new Map<string, ClaimRow>()).values()].sort((a, b) => b.claimed - a.claimed);

  return {
    period, range, kpis, series, trimmedBucket, byCustomer, split, viaBrokerCount: viaBroker.length, byEquipment,
    lanes, drivers: driverRows, trucks: truckRows, claims: claimRows,
    maintenance: { spend: maint.spend, records: maint.records, costPerKm: maint.costPerKm },
  };
}
export type ReportData = Awaited<ReturnType<typeof reportData>>;
