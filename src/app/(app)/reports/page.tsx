import Link from "next/link";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { date, money, money2, number } from "@/lib/format";
import { Card, InfoTip, LinkButton, PageHeader, Segmented } from "@/components/ui";
import { maintenanceHref } from "@/app/(app)/maintenance/_lib/links";
import { reportData } from "./data";
import {
  PERIODS, REPORT_PERIODS, costDeltaTone, deltaPct, exportHref, fmtDelta, fmtPerKm, parsePeriod, reportsHref, type ExportType, type ReportPeriod,
} from "./shared";
import { ReportTile } from "./tiles";
import { SpendChart } from "./spend-chart";
import { CategoryTable, ComplianceTable, DOWNTIME_LIMIT, DowntimeTable, TruckCostTable, VENDOR_LIMIT, VendorTable } from "./tables";

export const metadata = { title: "Reports" };

const plural = (n: number, one: string, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

function ExportLink({ type, period }: { type: ExportType; period: ReportPeriod }) {
  return <LinkButton href={exportHref(type, period)} variant="ghost" size="sm" prefetch={false} title="Download every row as CSV"><Download />CSV</LinkButton>;
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{children}</Link>;
}

/** A figure with its unit set smaller, so "31.2 L/100 km" fits a tile. */
const withUnit = (value: string, unit: string) => <>{value}<span className="ml-1 text-[13px] font-medium tracking-normal text-fg-subtle">{unit}</span></>;

const titled = (title: string, tip: ReactNode) => <span className="flex items-center gap-1.5">{title}<InfoTip>{tip}</InfoTip></span>;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireUser("reports.view");
  const period = parsePeriod((await searchParams).period);
  const r = await reportData(period);
  const k = r.kpis;
  const { from, to, days } = r.range;
  const before = (v: string) => `The ${days} days before: ${v}.`;
  const change = (cur: number | null, prev: number | null) => {
    const d = deltaPct(cur, prev);
    return { delta: fmtDelta(d), deltaTone: costDeltaTone(d) };
  };
  const logHref = maintenanceHref({ tab: "log", period });

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <span>Fleet running costs <span className="num text-fg">{date(from)} – {date(to)}</span></span>
            <InfoTip>{PERIODS[period].hint} up to today, the same windows as Maintenance. Changes (+/−%) compare with the {days} days before.</InfoTip>
          </span>
        }
        actions={<Segmented active={period} items={REPORT_PERIODS.map((p) => ({ key: p, label: PERIODS[p].label, href: reportsHref(p) }))} />}
      />

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ReportTile label="Maintenance" value={money(k.maintenance.value)} {...change(k.maintenance.value, k.maintenance.prev)}
          tip={<>Completed work orders (labour and parts) on trucks and trailers, by completion date. {before(money(k.maintenance.prev))}</>}
          note={k.maintenance.jobs ? `${plural(k.maintenance.jobs, "job")} completed` : "no completed jobs"}
          href={logHref} action="Repair log" />
        <ReportTile label="Fuel" value={money(k.fuel.value)} {...change(k.fuel.value, k.fuel.prev)}
          tip={<>Fuel fills logged on the trucks, by fill date. {before(money(k.fuel.prev))}</>}
          note={k.fuel.fills ? `${number(Math.round(k.fuel.liters))} L${k.fuel.perLiter != null ? ` · ${money2(k.fuel.perLiter)}/L` : ""}` : "no fuel fills logged"}
          noteTone={k.fuel.fills ? undefined : "warn"}
          href={k.fuel.fills ? "#trucks" : "/fleet"} action={k.fuel.fills ? "Per truck" : "Log fuel on a truck"} />
        <ReportTile label="Km driven" value={withUnit(number(k.km.value), "km")} delta={fmtDelta(deltaPct(k.km.value, k.km.prev))}
          tip={<>From odometer readings: fuel fills, work orders and each truck&apos;s current odometer. Per truck, the highest reading in the period minus the last one before it; a truck with fewer than two readings counts zero. {before(`${number(k.km.prev)} km`)}</>}
          note={k.km.withoutKm ? `${plural(k.km.withoutKm, "active truck")} without readings` : `across ${plural(k.km.trucks, "truck")}`}
          noteTone={k.km.withoutKm ? "warn" : undefined}
          href={k.km.withoutKm ? "/fleet" : "#trucks"} action={k.km.withoutKm ? "Update odometer readings" : "Per truck"} />
        <ReportTile label="Cost per km" value={fmtPerKm(k.costPerKm.value)} {...change(k.costPerKm.value, k.costPerKm.prev)}
          tip={<>Maintenance plus fuel, divided by km driven. Trailer work counts in the maintenance part. {k.costPerKm.prev != null ? before(fmtPerKm(k.costPerKm.prev)) : ""}</>}
          note={k.costPerKm.value != null ? `maintenance ${fmtPerKm(k.costPerKm.maintenance)} · fuel ${fmtPerKm(k.costPerKm.fuel)}` : "needs km driven"}
          href="#trucks" action="Per truck" />
        <ReportTile label="Fuel economy" value={k.l100.value != null ? withUnit(k.l100.value.toFixed(1), "L/100 km") : "—"} {...change(k.l100.value, k.l100.prev)}
          tip={<>Litres filled ÷ km driven × 100, over the trucks with both in the period. Short periods swing with when trucks happen to fill up; quarter and year read truer. {k.l100.prev != null ? before(`${k.l100.prev.toFixed(1)} L/100 km`) : ""}</>}
          note={k.l100.high ? `${plural(k.l100.high, "truck")} well above average` : k.l100.measured ? `average of ${plural(k.l100.measured, "truck")}` : "needs fuel fills and km"}
          noteTone={k.l100.high ? "warn" : undefined}
          href="#trucks" action="Per truck" />
        <ReportTile label="Downtime" value={withUnit(number(Math.round(k.downtime.value)), Math.round(k.downtime.value) === 1 ? "day" : "days")} {...change(k.downtime.value, k.downtime.prev)}
          tip={<>Days units spent in the shop in the period, from work orders&apos; in and out times (a job still in progress counts to now).{k.downtime.availability != null ? ` Trucks in service were available ${k.downtime.availability}% of the time.` : ""} {before(`${number(Math.round(k.downtime.prev))} days`)}</>}
          note={k.downtime.inShopNow ? `${plural(k.downtime.inShopNow, "unit")} in the shop now` : k.downtime.availability != null ? `${k.downtime.availability}% truck availability` : "nothing in the shop"}
          noteTone={k.downtime.inShopNow ? "warn" : undefined}
          href={maintenanceHref({ tab: "shop" })} action="In shop" />
      </section>

      {/* Trend and paperwork */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"
          title={titled("Running costs per month", "Maintenance (completed work orders, by completion date) and fuel (fills, by fill date) per calendar month; the current month runs to today. Hover a month for its figures.")}
          actions={<ExportLink type="monthly" period={period} />}>
          <SpendChart data={r.monthly} />
        </Card>
        <Card flush title={titled("Paperwork today", "Documents as they stand today, whatever the period. Each unit or driver counts once, under its worst document.")}
          actions={<HeaderLink href="/maintenance?tab=compliance">Compliance</HeaderLink>}>
          <ComplianceTable rows={r.paperwork} />
        </Card>
      </div>

      {/* Cost per truck */}
      <Card id="trucks" flush className="mt-4 scroll-mt-20"
        title={titled("Cost per truck", "Every truck in service, most expensive first. Orange figures are well above the fleet average and worth a look: driving style, idling, a fuel card, or a repair that keeps coming back.")}
        actions={<><span className="num hidden text-[11px] text-fg-subtle sm:inline">{money(r.running.total)} · {fmtPerKm(k.costPerKm.value)}/km fleet-wide</span><ExportLink type="trucks" period={period} /></>}>
        <TruckCostTable rows={r.trucks} totals={r.truckTotals} trailers={r.trailerWork} period={period} fleetCostPerKm={k.costPerKm.value} />
      </Card>

      {/* Where the maintenance money goes */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card flush title={titled("Maintenance by category", "Completed work in the period by kind of job. A category opens its jobs in the repair log.")}
          actions={<><HeaderLink href={logHref}>Repair log</HeaderLink><ExportLink type="categories" period={period} /></>}>
          <CategoryTable rows={r.categories} period={period} spend={k.maintenance.value} />
        </Card>
        <Card flush title={titled("Top vendors", "Shops by spend on completed work in the period. A vendor opens its jobs in the repair log.")}
          actions={<>{r.vendors.length > VENDOR_LIMIT && <span className="num text-[11px] text-fg-subtle">Top {VENDOR_LIMIT} of {number(r.vendors.length)}</span>}<ExportLink type="vendors" period={period} /></>}>
          <VendorTable rows={r.vendors} period={period} />
        </Card>
      </div>

      {/* Downtime */}
      <Card flush className="mt-4"
        title={titled("Downtime per unit", "Units that spent time in the shop in the period, longest first. The longest job opens the work order.")}
        actions={<>{r.downtime.length > DOWNTIME_LIMIT && <span className="num text-[11px] text-fg-subtle">Top {DOWNTIME_LIMIT} of {number(r.downtime.length)}</span>}<HeaderLink href={maintenanceHref({ tab: "shop" })}>In shop now</HeaderLink><ExportLink type="downtime" period={period} /></>}>
        <DowntimeTable rows={r.downtime} />
      </Card>
    </>
  );
}
