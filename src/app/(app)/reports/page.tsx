import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { date, fmtMoneyCompact, money, number } from "@/lib/format";
import { Card, InfoTip, LinkButton, PageHeader, Segmented, Stat } from "@/components/ui";
import { Bars, ChartEmpty } from "@/components/charts-lite";
import { Donut, RevenueChart, SimpleBar, TrendLine } from "@/components/charts-lazy";
import { reportData } from "./data";
import { PERIODS, PERIOD_KEYS, deltaTone, exportHref, fmtDelta, fmtPerKm, fmtPts, parsePeriod, reportsHref, type ExportType, type PeriodKey } from "./shared";
import { ClaimsTable, DriverTable, LANE_LIMIT, LaneTable, TruckTable } from "./tables";

export const metadata = { title: "Reports" };

const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

function ExportLink({ type, period }: { type: ExportType; period: PeriodKey }) {
  return <LinkButton href={exportHref(type, period)} variant="ghost" size="sm" prefetch={false} title="Download as CSV"><Download />CSV</LinkButton>;
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireUser("reports.view");
  const period = parsePeriod((await searchParams).period);
  const r = await reportData(period);
  const k = r.kpis;
  const { from, to, days } = r.range;
  const compare = r.range.months ? `the previous ${r.range.months} months` : `the previous ${days} days`;
  const bucket = r.range.months ? "month" : "week";
  // Only call out a $/km move once it is visible at two decimals.
  const perKmRaw = k.perKm != null && k.perKmPrev != null ? k.perKm - k.perKmPrev : null;
  const perKmDiff = perKmRaw != null && Math.abs(perKmRaw) >= 0.005 ? perKmRaw : null;
  // On-time % and load counts get a chart each: a percentage and a count do not share an axis. A bucket with
  // no deliveries has no on-time rate, so it is left out of the line (a gap) rather than plotted as 0%.
  const delivered = r.series.some((p) => p.loads > 0);
  const onTimeSeries = r.series.map((p): Record<string, string | number> => (p.loads ? { month: p.month, onTimePct: p.onTimePct } : { month: p.month }));
  const loadsSeries = r.series.map((p) => ({ month: p.month, Loads: p.loads }));

  return (
    <>
      <PageHeader
        eyebrow="Money & safety"
        title="Reports"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <span>Delivered <span className="num text-fg">{date(from)} – {date(to)}</span></span>
            <InfoTip>Completed loads delivered in this window. Deltas compare with {compare}.</InfoTip>
          </span>
        }
        actions={<Segmented active={period} items={PERIOD_KEYS.map((p) => ({ key: p, label: PERIODS[p].label, href: reportsHref(p) }))} />}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Revenue" value={money(k.revenue)} delta={fmtDelta(k.revenueDelta)} deltaTone={deltaTone(k.revenueDelta)}
          hint={k.loads ? `${money(k.loads ? k.revenue / k.loads : 0)} per load` : "no deliveries in this period"} />
        <Stat label="Gross margin" value={money(k.margin)} delta={fmtPts(k.marginDelta)} deltaTone={deltaTone(k.marginDelta)}
          tone={k.loads ? (k.marginPct < 15 ? "danger" : k.marginPct < 25 ? "warn" : "ok") : "neutral"}
          hint={k.loads ? `${k.marginPct}% of revenue after driver pay, fuel and other costs` : "—"} />
        <Stat label="Loads delivered" value={number(k.loads)} delta={fmtDelta(k.loadsDelta)} deltaTone={deltaTone(k.loadsDelta)}
          hint={k.loads ? `${(k.loads / Math.max(1, days / 7)).toFixed(1)} per week on average` : "—"} />
        <Stat label="Distance" value={`${number(k.km)} km`} delta={fmtDelta(k.kmDelta)} deltaTone={deltaTone(k.kmDelta)}
          hint={`${number(k.loadedKm)} loaded · ${number(k.emptyKm)} empty`} />
        <Stat label="Revenue per km" value={fmtPerKm(k.perKm)}
          delta={perKmDiff != null ? `${perKmDiff > 0 ? "+" : "-"}$${Math.abs(perKmDiff).toFixed(2)}` : undefined}
          deltaTone={perKmDiff != null ? (perKmDiff > 0 ? "ok" : "danger") : undefined}
          hint={k.perKmPrev != null ? `over loaded and empty km · ${fmtPerKm(k.perKmPrev)} before` : "over loaded and empty km"} />
        <Stat label="On time" value={k.loads ? `${k.onTimePct}%` : "—"} delta={fmtPts(k.onTimeDelta)} deltaTone={deltaTone(k.onTimeDelta)}
          tone={k.loads ? (k.onTimePct < 80 ? "danger" : k.onTimePct < 90 ? "warn" : "ok") : "neutral"}
          hint={k.loads ? `${plural(k.onTime, "delivery", "deliveries")} inside the window` : "—"} />
        <Stat label="Empty km" value={k.km ? `${k.emptyPct}%` : "—"} delta={fmtPts(k.emptyDelta)} deltaTone={deltaTone(k.emptyDelta, false)}
          tone={k.km ? (k.emptyPct > 20 ? "danger" : k.emptyPct > 12 ? "warn" : "ok") : "neutral"}
          hint={k.km ? `${number(k.emptyKm)} of ${number(k.km)} km run without freight` : "—"} />
        <Stat label="Claims cost" value={money(k.claimsCost)} tone={k.claimsOpen ? "warn" : "neutral"}
          hint={k.claimsCount ? `${plural(k.claimsCount, "claim")} · ${k.claimsOpen} open, ${money(k.claimsExposure)} unresolved · ${money(k.claimsSettled)} settled` : "no incidents in this period"} />
      </div>

      {/* Trends */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"
          title={<span className="flex items-center gap-1.5">Revenue vs direct costs<InfoTip>Per {bucket}; the gap between the lines is gross margin.{r.trimmedBucket ? ` ${r.trimmedBucket} has no deliveries yet, so it is left off.` : ""}</InfoTip></span>}>
          <RevenueChart data={r.series} height={270} />
        </Card>
        <Card title={<span className="flex items-center gap-1.5">Delivery performance<InfoTip>On-time rate and loads delivered per {bucket}.</InfoTip></span>}>
          {delivered ? (
            <>
              <p className="eyebrow mb-1">On time</p>
              <TrendLine data={onTimeSeries} height={120} suffix="%" format="percent" lines={[{ key: "onTimePct", name: "On time", tone: "ok" }]} />
              <p className="eyebrow mb-1 mt-3">Loads delivered</p>
              <SimpleBar data={loadsSeries} dataKey="Loads" nameKey="month" tone="info" format="number" height={98} />
            </>
          ) : (
            <ChartEmpty height={270} title="No deliveries in this period" hint="On-time rate and load counts appear once loads are delivered. Try a longer period." />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Top customers by revenue" actions={<span className="num text-[11px] text-fg-subtle">{plural(r.byCustomer.length, "customer")} shipped</span>}>
          <Bars format="moneyCompact" labelWidth={132} data={r.byCustomer.slice(0, 8).map((c) => ({ label: c.name, value: c.revenue, hint: `${plural(c.loads, "load")} · ${money(c.revenue)}`, href: `/customers/${c.id}` }))} />
        </Card>
        <Card title="Revenue: direct vs via broker"
          actions={<span className="num text-[11px] text-fg-subtle">{plural(r.viaBrokerCount, "brokered load")}</span>}>
          <Donut data={r.split} tones={["info", "warn"]} total={fmtMoneyCompact(k.revenue)} totalLabel="revenue" height={220} />
        </Card>
        <Card title="Loads by equipment">
          <Donut data={r.byEquipment} totalLabel="loads" height={220} />
        </Card>
      </div>

      {/* Tables */}
      <Card flush className="mt-4"
        title={<span className="flex items-center gap-1.5">Lane profitability<InfoTip>Lanes ranked by revenue. The table shows the top {LANE_LIMIT}; the CSV export has every lane.</InfoTip></span>}
        actions={<>{r.lanes.length > LANE_LIMIT && <span className="num text-[11px] text-fg-subtle">Top {LANE_LIMIT} of {number(r.lanes.length)}</span>}<ExportLink type="lanes" period={period} /></>}>
        <LaneTable rows={r.lanes} />
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card flush className="xl:col-span-3" title="Driver performance" actions={<ExportLink type="drivers" period={period} />}>
          <DriverTable rows={r.drivers} />
        </Card>
        <Card flush className="xl:col-span-2" title="Claims summary"
          actions={<LinkButton href="/claims" variant="ghost" size="sm">All claims</LinkButton>}>
          <ClaimsTable rows={r.claims} />
        </Card>
      </div>

      <Card flush className="mt-4" title="Truck performance"
        actions={<><span className="num hidden text-[11px] text-fg-subtle sm:inline">{money(r.maintenance.spend)} shop spend · {fmtPerKm(r.maintenance.costPerKm)}/km fleet-wide</span><ExportLink type="trucks" period={period} /></>}>
        <TruckTable rows={r.trucks} />
      </Card>
    </>
  );
}
