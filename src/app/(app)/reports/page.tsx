import Link from "next/link";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getLocale } from "@/lib/format-server";
import { makeFormat } from "@/lib/locale";
import { Card, InfoTip, LinkButton, PageHeader, Segmented } from "@/components/ui";
import { reportData } from "./data";
import { COMPLIANCE_HREF, DEFECTS_HREF, PRETRIP_HREF, ROADSIDE_HREF, SHOP_HREF, VENDORS_HREF, repairsHref } from "./links";
import {
  MONEY_HIDDEN, PERIODS, REPEAT_WINDOW_DAYS, REPORT_PERIODS, costDeltaTone, deltaPct, economyDeltaTone, exportHref, fmtDelta, plural, reportsHref,
  parsePeriod, type ExportType, type ReportPeriod,
} from "./shared";
import { MiniStat, ReportTile } from "./tiles";
import { SpendChart } from "./spend-chart";
import { WeekChart } from "./week-chart";
import {
  DOWNTIME_LIMIT, DowntimeTable, DriverChargeTable, LIST_LIMIT, PaperworkTable, REPEAT_LIMIT, RepairTypeTable, RepeatTable, RoadsideLevelTable,
  RoadsideList, SystemTable, TruckCostTable, VENDOR_LIMIT, VendorTable, WarrantyTable,
} from "./tables";

export const metadata = { title: "Reports" };

function ExportLink({ type, period }: { type: ExportType; period: ReportPeriod }) {
  return <LinkButton href={exportHref(type, period)} variant="ghost" size="sm" prefetch={false} title="Download every row as CSV"><Download />CSV</LinkButton>;
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{children}</Link>;
}

function Count({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <span className="num hidden text-[11px] text-fg-subtle sm:inline">Top {shown} of {total.toLocaleString("en-US")}</span> : null;
}

/** A figure with its unit set smaller, so "31.2 L/100 km" fits a tile. */
const withUnit = (value: string, unit: string) => <>{value}<span className="ml-1 text-[13px] font-medium tracking-normal text-fg-subtle">{unit}</span></>;

const titled = (title: string, tip: ReactNode) => <span className="flex items-center gap-1.5">{title}<InfoTip>{tip}</InfoTip></span>;

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-8 scroll-mt-20">
      <div className="mb-3">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-[-0.005em] text-fg">{title}</h2>
        <p className="text-[12px] text-fg-subtle">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const JUMPS = [["costs", "Costs"], ["repairs", "Repairs"], ["charges", "Driver charges"], ["inspections", "Inspections"], ["roadside", "Roadside"]] as const;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const me = await requireUser("reports.view");
  const money = can(me.role, "money.view");
  const locale = await getLocale();
  const f = makeFormat(locale);
  const L = f.labels;
  const period = parsePeriod((await searchParams).period);
  const now = new Date();
  const r = await reportData(period, locale, { money }, now);
  const k = r.kpis;
  const { from, to, days } = r.range;
  const before = (v: string) => `The ${days} days before: ${v}.`;
  const change = (cur: number | null, prev: number | null) => {
    const d = deltaPct(cur, prev);
    return { delta: fmtDelta(d), deltaTone: costDeltaTone(d) };
  };
  const neutral = (cur: number | null, prev: number | null) => ({ delta: fmtDelta(deltaPct(cur, prev)) });
  const economyChange = (() => {
    const d = deltaPct(k.economy.value, k.economy.prev);
    return { delta: fmtDelta(d), deltaTone: economyDeltaTone(d, L.economyHigherIsBetter) };
  })();
  const perVolume = k.fuel.perVolume != null ? ` · ${f.money3(k.fuel.perVolume)}/${L.volume}` : "";
  const ds = r.defectSummary;
  const ws = r.walkSummary;
  const rs = r.roadsideSummary;
  const cs = r.chargeSummary;
  const pctText = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  const distanceTile = (
    <ReportTile label="Distance driven" value={withUnit(f.number(k.distance.value), L.distance)} {...neutral(k.distance.value, k.distance.prev)}
      tip={<>From odometer readings: fuel fills, repair orders and each truck&apos;s current odometer. Per truck, the highest reading in the period minus the last one before it; a truck with fewer than two readings counts zero. {before(f.dist(k.distance.prev))}</>}
      note={k.distance.withoutReadings ? `${plural(k.distance.withoutReadings, "active truck")} without readings` : `across ${plural(k.distance.trucks, "truck")}`}
      noteTone={k.distance.withoutReadings ? "warn" : undefined}
      href={k.distance.withoutReadings ? "/fleet" : "#trucks"} action={k.distance.withoutReadings ? "Update odometer readings" : "Per truck"} />
  );
  const economyTile = (
    <ReportTile label="Fuel economy" value={k.economy.value != null ? withUnit(f.decimal(k.economy.value), L.economy) : "—"} {...economyChange}
      tip={<>Fuel filled and distance driven, over the trucks with both in the period, as {L.economy}{L.economyHigherIsBetter ? " (higher is better)" : " (lower is better)"}. Short periods swing with when trucks happen to fill up; quarter and year read truer. {k.economy.prev != null ? before(f.economyText(k.economy.prev)) : ""}</>}
      note={k.economy.worse ? `${plural(k.economy.worse, "truck")} well below average` : k.economy.measured ? `average of ${plural(k.economy.measured, "truck")}` : "needs fuel fills and odometer readings"}
      noteTone={k.economy.worse ? "warn" : undefined}
      href="#trucks" action="Per truck" />
  );
  const downtimeTile = (
    <ReportTile label="Downtime" value={withUnit(f.number(Math.round(k.downtime.value)), Math.round(k.downtime.value) === 1 ? "day" : "days")} {...change(k.downtime.value, k.downtime.prev)}
      tip={<>Days units spent in the shop in the period, from repair orders&apos; in and out times (an order still in the shop counts to now).{k.downtime.availability != null ? ` Trucks in service were available ${k.downtime.availability}% of the time.` : ""} {before(`${f.number(Math.round(k.downtime.prev))} days`)}</>}
      note={k.downtime.inShopNow ? `${plural(k.downtime.inShopNow, "unit")} in the shop now` : k.downtime.availability != null ? `${k.downtime.availability}% truck availability` : "nothing in the shop"}
      noteTone={k.downtime.inShopNow ? "warn" : undefined}
      href="#downtime" action="Per unit" />
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span>Fleet, shop and inspections <span className="num text-fg">{f.date(from)} – {f.date(to)}</span></span>
            <InfoTip>{PERIODS[period].hint} up to now, on the company&apos;s calendar ({f.zone(now)}). Changes (+/−%) compare with the same stretch of time right before it.</InfoTip>
          </span>
        }
        actions={<Segmented active={period} items={REPORT_PERIODS.map((p) => ({ key: p, label: PERIODS[p].label, href: reportsHref(p) }))} />}
      >
        {!money && <p className="mt-0.5 text-[12px] text-fg-subtle">{MONEY_HIDDEN} You see the work, the distances and the counts.</p>}
      </PageHeader>

      <nav aria-label="Report sections" className="-mt-2 mb-4 flex flex-wrap gap-x-4 gap-y-1">
        {JUMPS.map(([id, label]) => <a key={id} href={`#${id}`} className="text-[12px] font-medium text-fg-muted hover:text-fg">{label}</a>)}
      </nav>

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {money ? (
          <>
            <ReportTile label="Maintenance" value={f.money(k.maintenance.value)} {...change(k.maintenance.value, k.maintenance.prev)}
              tip={<>Completed repair orders on trucks and trailers, by completion date. Voided orders never count. {before(f.money(k.maintenance.prev))}</>}
              note={k.maintenance.jobs ? `${plural(k.maintenance.jobs, "repair")} completed` : "no completed repairs"}
              href="#repairs" action="Where it went" />
            <ReportTile label="Fuel" value={f.money(k.fuel.value)} {...change(k.fuel.value, k.fuel.prev)}
              tip={<>Fuel fills logged on the trucks, by fill date. {before(f.money(k.fuel.prev))}</>}
              note={k.fuel.fills ? `${f.vol(k.fuel.volume)}${perVolume}` : "no fuel fills logged"}
              noteTone={k.fuel.fills ? undefined : "warn"}
              href={k.fuel.fills ? "#trucks" : "/fleet"} action={k.fuel.fills ? "Per truck" : "Log fuel on a truck"} />
            {distanceTile}
            <ReportTile label={`Cost ${L.perDistance}`} value={k.costPerDistance.value != null ? f.money2(k.costPerDistance.value) : "—"} {...change(k.costPerDistance.value, k.costPerDistance.prev)}
              tip={<>Maintenance plus fuel, divided by distance driven. Trailer work counts in the maintenance part. {k.costPerDistance.prev != null ? before(f.money2(k.costPerDistance.prev)) : ""}</>}
              note={k.costPerDistance.value != null ? `maintenance ${f.money2(k.costPerDistance.maintenance)} · fuel ${f.money2(k.costPerDistance.fuel)}` : `needs distance driven`}
              href="#trucks" action="Per truck" />
            {economyTile}
            {downtimeTile}
          </>
        ) : (
          <>
            <ReportTile label="Repairs completed" value={f.number(k.maintenance.jobs)} {...neutral(k.maintenance.jobs, k.maintenance.prevJobs)}
              tip={<>Repair orders completed on trucks and trailers in the period. {before(f.number(k.maintenance.prevJobs))}</>}
              note="on trucks and trailers" href="#repairs" action="By type" />
            <ReportTile label="Fuel used" value={withUnit(f.number(k.fuel.volume), L.volume)} {...neutral(k.fuel.volume, k.fuel.prevVolume)}
              tip={<>Fuel fills logged on the trucks, by fill date. {before(f.vol(k.fuel.prevVolume))}</>}
              note={k.fuel.fills ? plural(k.fuel.fills, "fill") : "no fuel fills logged"} noteTone={k.fuel.fills ? undefined : "warn"}
              href="#trucks" action="Per truck" />
            {distanceTile}
            {economyTile}
            {downtimeTile}
            <ReportTile label="Defects open" value={f.number(ds.open + ds.toConfirm)}
              tip="Defects found on walk-arounds or reported, not yet closed. Repaired ones wait for someone to confirm the fix."
              note={ds.holdingTrucks ? `${plural(ds.holdingTrucks, "truck")} held out of service` : ds.toConfirm ? `${ds.toConfirm} repaired, to confirm` : "none holding a truck"}
              noteTone={ds.holdingTrucks ? "danger" : undefined}
              href={DEFECTS_HREF} action="Defects" />
          </>
        )}
      </section>

      {/* Costs */}
      <Section id="costs" title="Costs and paperwork" hint="What the fleet costs to run, and the documents that keep it on the road.">
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2"
            title={titled("Running costs per month", "Maintenance (completed repair orders, by completion date) and fuel (fills, by fill date) per calendar month, company time; the current month runs to today. Hover a month for its figures.")}
            actions={<ExportLink type="monthly" period={period} />}>
            {money ? <SpendChart f={f} data={r.monthly} /> : <p className="py-6 text-center text-[12px] text-fg-subtle">{MONEY_HIDDEN} The CSV has the jobs and fuel volume per month.</p>}
          </Card>
          <Card flush title={titled("Paperwork today", "Documents as they stand today, whatever the period. Each unit or driver counts once, under its worst document.")}
            actions={<HeaderLink href={COMPLIANCE_HREF}>Compliance</HeaderLink>}>
            <PaperworkTable rows={r.paperwork} />
          </Card>
        </div>

        <Card id="trucks" flush className="mt-4 scroll-mt-20"
          title={titled(money ? "Cost per truck" : "Distance and fuel per truck", "Every truck in service. Orange figures are well off the fleet average and worth a look: driving style, idling, a fuel card, or a repair that keeps coming back.")}
          actions={<>{money && <span className="num hidden text-[11px] text-fg-subtle sm:inline">{f.money(r.running.total)} · {k.costPerDistance.value != null ? `${f.money2(k.costPerDistance.value)} ${L.perDistance}` : "—"} fleet-wide</span>}<ExportLink type="trucks" period={period} /></>}>
          <TruckCostTable f={f} money={money} rows={r.trucks} totals={r.truckTotals} trailers={r.trailerWork} fleetCostPerDistance={k.costPerDistance.value} />
        </Card>
      </Section>

      {/* Repairs */}
      <Section id="repairs" title="Repairs" hint="What the shop worked on, who did it, what keeps coming back and how long units were off the road.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card flush title={titled("Repairs by type", "Completed repair orders in the period by type of visit.")}
            actions={<><HeaderLink href={repairsHref()}>Repairs</HeaderLink><ExportLink type="repair-types" period={period} /></>}>
            <RepairTypeTable f={f} money={money} rows={r.repairTypes} spend={k.maintenance.value} />
          </Card>
          <Card flush title={titled("Top vendors", money ? "Shops by spend on completed repair orders in the period. A vendor opens its page." : "Shops by completed repair orders in the period. A vendor opens its page.")}
            actions={<><Count shown={VENDOR_LIMIT} total={r.vendors.length} /><HeaderLink href={VENDORS_HREF}>Vendors</HeaderLink><ExportLink type="vendors" period={period} /></>}>
            <VendorTable f={f} money={money} rows={r.vendors} />
          </Card>
          <Card flush title={titled("Repairs by system", "The lines of work on completed repair orders (what was done), grouped by system.")}
            actions={<ExportLink type="systems" period={period} />}>
            <SystemTable f={f} money={money} rows={r.systems} />
          </Card>
          <Card flush title={titled("Repeat repairs", `The same system repaired on the same unit twice or more within ${REPEAT_WINDOW_DAYS} days: a fix that did not hold, or a part worth replacing for good. Oil changes and fees are left out.`)}
            actions={<><Count shown={REPEAT_LIMIT} total={r.repeats.length} /><ExportLink type="repeats" period={period} /></>}>
            <RepeatTable f={f} money={money} rows={r.repeats} />
          </Card>
        </div>
        <Card id="downtime" flush className="mt-4 scroll-mt-20"
          title={titled("Downtime per unit", "Units that spent time in the shop in the period, longest first. The longest repair opens its repair order.")}
          actions={<><Count shown={DOWNTIME_LIMIT} total={r.downtime.length} /><HeaderLink href={SHOP_HREF}>In the shop now</HeaderLink><ExportLink type="downtime" period={period} /></>}>
          <DowntimeTable f={f} rows={r.downtime} />
        </Card>
      </Section>

      {/* Driver charges and warranty */}
      <Section id="charges" title="Driver charges and warranty" hint="Repairs someone other than the company pays for, so none of it is forgotten.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card flush title={titled("Driver charges", "Repair orders charged to a driver in the period. Nothing comes off a driver's pay until the driver has been told.")}
            actions={<>{cs.untoldAll > 0 && <HeaderLink href={repairsHref()}><span className="text-warn">{plural(cs.untoldAll, "charge")} not told</span></HeaderLink>}<ExportLink type="driver-charges" period={period} /></>}>
            {cs.charges > 0 && (
              <div className="grid grid-cols-3 gap-3 px-4 pb-3 pt-1">
                <MiniStat label="Charges" value={f.number(cs.charges)} note={money ? f.money(cs.amount) : undefined} />
                <MiniStat label="Told" value={f.number(cs.told)} tone={cs.told ? "ok" : undefined} />
                <MiniStat label="Not told" value={f.number(cs.notTold)} tone={cs.notTold ? "warn" : undefined} note={money && cs.notTold ? f.money(cs.notToldAmount) : undefined}
                  tip={cs.untoldAll > cs.notTold ? `${plural(cs.untoldAll, "charge")} not told across every date${money ? `, ${f.money(cs.untoldAllAmount)}` : ""}.` : undefined} />
              </div>
            )}
            <DriverChargeTable f={f} money={money} rows={r.driverCharges} />
          </Card>
          <Card flush title={titled("Warranty claims", "Repair orders marked as a warranty claim: every one still open, and those completed in the period. Open longest first.")}
            actions={<><Count shown={LIST_LIMIT} total={r.warranty.length} /><ExportLink type="warranty" period={period} /></>}>
            {r.warranty.length > 0 && (
              <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-1">
                <MiniStat label="Open" value={f.number(r.warrantySummary.open)} tone={r.warrantySummary.open ? "info" : undefined} note={money && r.warrantySummary.open ? f.money(r.warrantySummary.openAmount) : undefined} />
                <MiniStat label="Completed in the period" value={f.number(r.warrantySummary.completed)} note={money && r.warrantySummary.completed ? f.money(r.warrantySummary.completedAmount) : undefined} />
              </div>
            )}
            <WarrantyTable f={f} money={money} rows={r.warranty} />
          </Card>
        </div>
      </Section>

      {/* Inspections */}
      <Section id="inspections" title="Inspections" hint="What the weekly walk-arounds found, how fast it was fixed, and whether every truck sent its video.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={titled("Defects found and closed", "Defects found on walk-arounds or reported, and defects closed after the repair was confirmed, per week. Days to close: from found to closed, for defects closed in the period.")}
            actions={<><HeaderLink href={DEFECTS_HREF}>Defects</HeaderLink><ExportLink type="defects" period={period} /></>}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Found" value={f.number(ds.found)} note="in the period" />
              <MiniStat label="Closed" value={f.number(ds.closed)} note="in the period" />
              <MiniStat label="Days to close" value={ds.avgDaysToClose != null ? f.decimal(ds.avgDaysToClose) : "—"} note="on average" />
              <MiniStat label="Open now" value={f.number(ds.open + ds.toConfirm)} tone={ds.holdingTrucks ? "danger" : ds.overdue ? "warn" : undefined}
                note={ds.holdingTrucks ? `${plural(ds.holdingTrucks, "truck")} held` : ds.overdue ? `${ds.overdue} past due` : ds.toConfirm ? `${ds.toConfirm} to confirm` : "none holding a truck"} />
            </div>
            <WeekChart
              series={[{ label: "Found", swatch: "bg-warn" }, { label: "Closed", swatch: "bg-progress" }]}
              points={r.defectWeeks.map((w) => ({ key: w.key, label: f.day(w.from), partial: w.partial, values: [w.found, w.closed], lines: [`${w.found} found`, `${w.closed} closed`] }))}
              emptyTitle="No defects in these weeks" emptyHint="Defects come from walk-around reviews and reports; found and closed ones add up here per week." />
          </Card>
          <Card title={titled("Walk-around videos", "Videos received each week out of the trucks that have a driver (today's assignments; a week with more trucks on record counts those). Weeks start on " + (f.imperial ? "Sunday." : "Monday."))}
            actions={<><HeaderLink href={PRETRIP_HREF}>Pre-trip board</HeaderLink><ExportLink type="walkarounds" period={period} /></>}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MiniStat label="This week" value={ws.current ? `${ws.current.received}/${ws.current.expected}` : "—"} note={`due by the end of ${f.weekday(ws.dueAt)}`}
                tone={ws.current && ws.current.expected > ws.current.received ? "warn" : undefined} />
              <MiniStat label="Average" value={pctText(ws.average)} note="over the full weeks shown" />
              <MiniStat label="Trucks with a driver" value={f.number(ws.trucksWithDriver)} note="expected every week" />
            </div>
            <WeekChart percent
              series={[{ label: "Received", swatch: "bg-progress" }]}
              points={r.walkWeeks.map((w) => ({
                key: w.key, label: f.day(w.from), partial: w.partial, values: [w.expected ? w.rate : null],
                lines: [`${w.received} of ${w.expected} received`, `${w.reviewed} reviewed`, ...(w.issues ? [`${w.issues} with issues`] : [])],
              }))}
              emptyTitle="No walk-around videos yet" emptyHint="Mark each truck's weekly video as received on the pre-trip board; the share received per week shows here." />
          </Card>
        </div>
      </Section>

      {/* Roadside */}
      <Section id="roadside" title="Roadside inspections" hint="DOT roadside inspections in the period: how many, what they found and how often a unit or driver was put out of service.">
        <Card flush title={titled("Roadside inspections", "Out-of-service rate: inspections with an out-of-service order (the result, or any violation marked out of service) divided by all inspections.")}
          actions={<><HeaderLink href={ROADSIDE_HREF}>Roadside</HeaderLink><ExportLink type="roadside" period={period} /></>}>
          <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-1 sm:grid-cols-5">
            <MiniStat label="Inspections" value={f.number(rs.inspections)} note={deltaPct(rs.inspections, rs.prevInspections) != null ? `${fmtDelta(deltaPct(rs.inspections, rs.prevInspections))} on the ${days} days before` : undefined} />
            <MiniStat label="Clean" value={f.number(rs.clean)} note={rs.inspections ? `${Math.round((rs.clean / rs.inspections) * 100)}% of inspections` : undefined} tone={rs.inspections && rs.clean === rs.inspections ? "ok" : undefined} />
            <MiniStat label="Violations" value={f.number(rs.violations)} note={rs.withViolations ? `on ${plural(rs.withViolations, "inspection")}` : undefined} tone={rs.violations ? "warn" : undefined} />
            <MiniStat label="Out-of-service rate" value={pctText(rs.oosRate)} note={rs.oos ? `${plural(rs.oos, "inspection")}${rs.prevOosRate != null ? ` · was ${pctText(rs.prevOosRate)}` : ""}` : undefined} tone={rs.oos ? "danger" : undefined} />
            <MiniStat label="Corrections open" value={f.number(rs.openCorrections)} note={rs.overdueCorrections ? `${rs.overdueCorrections} past due` : "as of today"} tone={rs.overdueCorrections ? "danger" : undefined} />
          </div>
          <div className="grid border-t border-line xl:grid-cols-5">
            <div className="xl:col-span-2 xl:border-r xl:border-line"><RoadsideLevelTable f={f} rows={r.roadsideLevels} /></div>
            <div className="border-t border-line xl:col-span-3 xl:border-t-0"><RoadsideList f={f} rows={r.roadside} now={now} /></div>
          </div>
        </Card>
      </Section>
    </>
  );
}
