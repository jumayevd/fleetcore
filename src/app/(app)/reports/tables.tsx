import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Container, Truck as TruckIcon } from "lucide-react";
import type { Formatter } from "@/lib/locale";
import { REPAIR_STAGE_LABELS, humanize } from "@/lib/constants";
import { roLabel } from "@/lib/service";
import { Badge, InfoTip, Progress, Table, cn } from "@/components/ui";
import type {
  DriverChargeRow, LevelRow, PaperworkGroup, RepairTypeRow, RepeatRow, ReportData, RoadsideRow, SystemRow, TruckRow, UnitRef, VendorRow, WarrantyRow,
} from "./data";
import { driverHref, repairHref, repairsHref, roadsideHref, unitHref, vendorHref } from "./links";
import {
  HIGH_BURN, HIGH_COST_PER_DISTANCE, MIN_DISTANCE_TO_COMPARE, REPEAT_WINDOW_DAYS, TONE_TEXT, burnsHigh, fmtDays, plural,
} from "./shared";

/*
 * Report tables (server components). Every table takes the company formatter `f` and `money`: without money.view the
 * money columns are left out and the shares are of jobs instead of spend.
 */

const R = (key: string, label: string) => <span key={key} className="block text-right">{label}</span>;
/** Right-aligned header with an explanation on hover. */
const RT = (key: string, label: string, tip: string) => <span key={key} className="flex items-center justify-end gap-1">{label}<InfoTip>{tip}</InfoTip></span>;
const dash = <span className="text-fg-faint">—</span>;
const totalRow = "bg-sunken/60 font-medium hover:bg-sunken/60";
const linkCls = "hover:underline";

/** Rows shown for the ranked tables; the CSV export has every row. */
export const VENDOR_LIMIT = 8;
export const DOWNTIME_LIMIT = 10;
export const REPEAT_LIMIT = 10;
export const LIST_LIMIT = 8;

type Common = { f: Formatter; money: boolean };

/** Unit number as a link to the truck or trailer, with a quiet type glyph. */
export function UnitCell({ unit, secondary }: { unit: UnitRef | null; secondary?: ReactNode }) {
  if (!unit) return <span className="text-fg-faint">—</span>;
  const Icon = unit.type === "truck" ? TruckIcon : Container;
  return (
    <div className="min-w-0">
      <Link href={unitHref(unit.type, unit.id)} className="inline-flex items-center gap-1.5 font-medium text-fg hover:underline">
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="num unit-no">{unit.unitNumber}</span>
      </Link>
      {secondary && <div className="truncate pl-5 text-[11px] text-fg-subtle">{secondary}</div>}
    </div>
  );
}

function RoLink({ id, number, title }: { id: string; number: number; title?: string }) {
  return (
    <Link href={repairHref(id)} className={cn("whitespace-nowrap", linkCls)} title={title ? `Open ${roLabel(number)}: ${title}` : `Open ${roLabel(number)}`}>
      <span className="num text-fg-muted">{roLabel(number)}</span>
      {title && <span className="ml-1 text-fg">{title}</span>}
    </Link>
  );
}

function ShareCell({ value }: { value: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Progress value={value / 100} tone="progress" className="w-16" />
      <span className="num w-8 text-right text-fg-muted">{value}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cost per truck                                                      */
/* ------------------------------------------------------------------ */

export function TruckCostTable({ f, money, rows, totals, trailers, fleetCostPerDistance }: Common & {
  rows: TruckRow[];
  totals: ReportData["truckTotals"];
  trailers: ReportData["trailerWork"];
  /** Fleet running cost per mi / km, to flag expensive trucks. */
  fleetCostPerDistance: number | null;
}) {
  const L = f.labels;
  const avg = totals.economy;
  const comparable = (r: TruckRow) => r.km >= MIN_DISTANCE_TO_COMPARE;
  const truckCostPerDistance = totals.km > 0 ? totals.total / totals.km : null;
  const head = [
    "Truck",
    RT("km", `Distance (${L.distance})`, "Highest odometer reading in the period minus the last one before it (fuel fills, repair orders, current odometer). A dash: fewer than two readings, so log the odometer with the next fill."),
    money ? RT("fuel", "Fuel", "Fuel fills logged in the period.") : RT("fuel", `Fuel (${L.volume})`, "Fuel filled in the period."),
    RT("econ", L.economy, `Fuel filled and distance driven in the period, as ${L.economy}. Orange when ${Math.round((HIGH_BURN - 1) * 100)}% or more worse than the fleet average (trucks with ${f.dist(MIN_DISTANCE_TO_COMPARE)} or more).`),
    money ? RT("maint", "Maintenance", "Completed repair orders on the truck in the period.") : RT("maint", "Repairs", "Completed repair orders on the truck in the period."),
    ...(money ? [R("total", "Total"), RT("cpd", `Cost ${L.perDistance}`, `Fuel plus maintenance divided by distance driven. Orange at ${HIGH_COST_PER_DISTANCE}× the fleet's cost ${L.perDistance} or more.`)] : []),
  ];
  return (
    <Table className="max-h-[560px]" dense head={head}
      empty={rows.length === 0} emptyTitle="No trucks yet" emptyDescription="Add trucks to the fleet; their fuel, repairs and distance are compared here.">
      {rows.map((r) => {
        const highBurn = avg != null && r.economy != null && comparable(r) && burnsHigh(r.economy, avg, L.economyHigherIsBetter);
        const highCost = fleetCostPerDistance != null && r.costPerKm != null && comparable(r) && r.costPerKm >= fleetCostPerDistance * HIGH_COST_PER_DISTANCE;
        return (
          <tr key={r.id}>
            <td className="whitespace-nowrap">
              <div className="flex items-center gap-1.5">
                <UnitCell unit={{ type: "truck", id: r.id, unitNumber: r.unitNumber }} secondary={r.model} />
                {r.status !== "ACTIVE" && <Badge value={r.status} label={r.status === "MAINTENANCE" ? "In maintenance" : undefined} />}
              </div>
            </td>
            <td className="num text-right text-fg-muted" title={r.km ? undefined : "No odometer readings to compare in this period"}>{r.km ? f.number(r.km) : dash}</td>
            <td className="num text-right" title={r.fills ? `${plural(r.fills, "fill")} · ${f.vol(r.liters)}` : "No fuel logged in this period"}>
              {r.fills ? (money ? f.money(r.fuel) : f.vol(r.liters)) : dash}
            </td>
            <td className={cn("num text-right", highBurn ? "font-medium text-warn" : "text-fg-muted")}
              title={highBurn && avg != null ? `Worse than the fleet average of ${f.economyText(avg)}` : undefined}>
              {r.economy != null ? f.decimal(r.economy) : dash}
            </td>
            <td className="num whitespace-nowrap text-right">
              {r.jobs ? (
                <Link href={repairsHref({ unit: r.id })} className={linkCls} title={`${plural(r.jobs, "completed repair order")}: open them`}>
                  {money ? <>{f.money(r.maintenance)} <span className="text-[11px] text-fg-subtle">· {r.jobs}</span></> : f.number(r.jobs)}
                </Link>
              ) : dash}
            </td>
            {money && <td className="num text-right font-medium">{r.total ? f.money(r.total) : dash}</td>}
            {money && (
              <td className={cn("num text-right", highCost ? "font-medium text-warn" : "text-fg")}
                title={highCost && fleetCostPerDistance != null ? `${(r.costPerKm! / fleetCostPerDistance).toFixed(1)}× the fleet's ${f.money2(fleetCostPerDistance)} ${L.perDistance}` : undefined}>
                {r.costPerKm != null ? f.money2(r.costPerKm) : dash}
              </td>
            )}
          </tr>
        );
      })}
      {trailers.jobs > 0 && (
        <tr>
          <td className="whitespace-nowrap">
            <Link href="/fleet/trailers" className="font-medium text-fg hover:underline">Trailers</Link>
            <div className="text-[11px] text-fg-subtle">repairs only</div>
          </td>
          <td className="text-right">{dash}</td>
          <td className="text-right">{dash}</td>
          <td className="text-right">{dash}</td>
          <td className="num whitespace-nowrap text-right">{money ? <>{f.money(trailers.maintenance)} <span className="text-[11px] text-fg-subtle">· {trailers.jobs}</span></> : f.number(trailers.jobs)}</td>
          {money && <td className="num text-right font-medium">{f.money(trailers.maintenance)}</td>}
          {money && <td className="text-right">{dash}</td>}
        </tr>
      )}
      {rows.length > 1 && (
        <tr className={totalRow}>
          <td className="text-[12px] text-fg-muted">Fleet · {plural(rows.length, "truck")}{trailers.jobs > 0 ? " + trailers" : ""}</td>
          <td className="num text-right">{f.number(totals.km)}</td>
          <td className="num text-right">{money ? f.money(totals.fuel) : f.vol(totals.liters)}</td>
          <td className="num text-right" title="Over trucks with both fuel and distance in the period">{avg != null ? f.decimal(avg) : "—"}</td>
          <td className="num text-right">{money ? f.money(totals.maintenance + trailers.maintenance) : f.number(totals.jobs + trailers.jobs)}</td>
          {money && <td className="num text-right">{f.money(totals.total + trailers.maintenance)}</td>}
          {money && <td className="num text-right" title={truckCostPerDistance != null ? `Trucks only: ${f.money2(truckCostPerDistance)}` : undefined}>{fleetCostPerDistance != null ? f.money2(fleetCostPerDistance) : "—"}</td>}
        </tr>
      )}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Repairs by type / vendor / system                                   */
/* ------------------------------------------------------------------ */

export function RepairTypeTable({ f, money, rows, spend }: Common & { rows: RepairTypeRow[]; spend: number }) {
  const jobs = rows.reduce((a, r) => a + r.jobs, 0);
  return (
    <Table dense
      head={[
        "Repair type", R("n", "Jobs"),
        ...(money ? [R("cost", "Spend"), RT("share", "Share", "Of the period's maintenance spend."), R("avg", "Avg per job")] : [RT("share", "Share", "Of the period's completed repair orders.")]),
        RT("days", "Avg in shop", "From each order's in and out times, for orders that recorded both."),
      ]}
      empty={rows.length === 0} emptyTitle="No completed repairs in this period" emptyDescription="Complete repair orders (or log one that is already done) to see what the shop spends its time on. Try a longer period.">
      {rows.map((r) => (
        <tr key={r.type}>
          <td className="whitespace-nowrap font-medium text-fg">{r.label}</td>
          <td className="num text-right text-fg-muted">{f.number(r.jobs)}</td>
          {money ? (
            <>
              <td className="num text-right font-medium">{f.money(r.cost)}</td>
              <td><ShareCell value={r.share} /></td>
              <td className="num text-right text-fg-muted">{f.money(r.avg)}</td>
            </>
          ) : <td><ShareCell value={jobs ? Math.round((r.jobs / jobs) * 100) : 0} /></td>}
          <td className="num text-right text-fg-muted">{r.avgShopDays != null ? fmtDays(r.avgShopDays) : dash}</td>
        </tr>
      ))}
      {rows.length > 1 && (
        <tr className={totalRow}>
          <td className="text-[12px] text-fg-muted">All types</td>
          <td className="num text-right">{f.number(jobs)}</td>
          {money ? <><td className="num text-right">{f.money(spend)}</td><td /><td className="num text-right">{f.money(jobs ? spend / jobs : 0)}</td></> : <td />}
          <td />
        </tr>
      )}
    </Table>
  );
}

export function VendorTable({ f, money, rows, limit = VENDOR_LIMIT }: Common & { rows: VendorRow[]; limit?: number }) {
  return (
    <Table dense
      head={["Vendor", R("n", "Jobs"), ...(money ? [R("cost", "Spend"), RT("share", "Share", "Of the period's maintenance spend."), R("avg", "Avg per job")] : [RT("share", "Share", "Of the period's completed repair orders.")])]}
      empty={rows.length === 0} emptyTitle="No completed repairs in this period" emptyDescription="Vendors appear once their repair orders are completed. Pick the vendor on each repair order to compare them.">
      {rows.slice(0, limit).map((r) => (
        <tr key={r.key}>
          <td className="max-w-56 truncate">
            {r.vendorId
              ? <Link href={vendorHref(r.vendorId)} className={cn("font-medium text-fg", linkCls)} title="Open the vendor">{r.label}</Link>
              : <span className={r.key === "none" ? "text-fg-subtle" : "text-fg"} title={r.key === "none" ? undefined : "Typed on the order, not linked to a vendor record"}>{r.label}</span>}
          </td>
          <td className="num text-right text-fg-muted">{f.number(r.jobs)}</td>
          {money ? (
            <>
              <td className="num text-right font-medium">{f.money(r.cost)}</td>
              <td><ShareCell value={r.share} /></td>
              <td className="num text-right text-fg-muted">{f.money(r.avg)}</td>
            </>
          ) : <td><ShareCell value={r.jobShare} /></td>}
        </tr>
      ))}
    </Table>
  );
}

export function SystemTable({ f, money, rows }: Common & { rows: SystemRow[] }) {
  return (
    <Table dense
      head={[
        "System", RT("o", "Orders", "Completed repair orders with work on this system."), RT("u", "Units", "Trucks and trailers that had this work."),
        ...(money ? [RT("amt", "Spend", "From the amounts on each order's lines of work."), RT("share", "Share", "Of the period's line amounts.")] : []),
      ]}
      empty={rows.length === 0} emptyTitle="No lines of work in this period" emptyDescription="Write what was done on each repair order (system, work, amount) when closing it; repairs then add up by system here.">
      {rows.map((r) => (
        <tr key={r.system}>
          <td className="whitespace-nowrap font-medium text-fg">{r.label}</td>
          <td className="num text-right text-fg-muted">{f.number(r.orders)}</td>
          <td className="num text-right text-fg-muted">{f.number(r.units)}</td>
          {money && <td className="num text-right font-medium">{f.money(r.amount)}</td>}
          {money && <td><ShareCell value={r.share} /></td>}
        </tr>
      ))}
    </Table>
  );
}

export function RepeatTable({ f, money, rows, limit = REPEAT_LIMIT }: Common & { rows: RepeatRow[]; limit?: number }) {
  return (
    <Table dense
      head={[
        "Unit", "System",
        RT("v", "Visits", `Repair orders with this system on the unit, in the period and the ${REPEAT_WINDOW_DAYS} days before it.`),
        RT("g", "Shortest gap", "Fewest days between two of those visits."),
        "Repair orders",
        ...(money ? [RT("amt", "Spent", "Line amounts for this system across those orders.")] : []),
      ]}
      empty={rows.length === 0} emptyTitle="No repeat repairs" emptyDescription={`Nothing came back: no unit had the same system repaired twice within ${REPEAT_WINDOW_DAYS} days.`}>
      {rows.slice(0, limit).map((r) => (
        <tr key={r.key}>
          <td><UnitCell unit={r.unit} /></td>
          <td className="whitespace-nowrap text-fg">{r.label}</td>
          <td className={cn("num text-right font-medium", r.within >= 3 ? "text-danger" : "text-warn")}>{r.visits}</td>
          <td className="num whitespace-nowrap text-right text-fg-muted">{plural(r.gapDays, "day")}</td>
          <td className="max-w-64">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {r.orders.slice(-4).map((o) => <RoLink key={o.id} id={o.id} number={o.number} />)}
            </div>
          </td>
          {money && <td className="num text-right">{r.amount ? f.money(r.amount) : dash}</td>}
        </tr>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Downtime per unit                                                   */
/* ------------------------------------------------------------------ */

export function DowntimeTable({ f, rows, limit = DOWNTIME_LIMIT }: { f: Formatter; rows: ReportData["downtime"]; limit?: number }) {
  return (
    <Table dense head={["Unit", R("n", "Orders"), RT("days", "In shop", "Days in the shop inside the period, from each repair order's in and out times. Two orders on the unit at once count once."), "Longest repair", "Now"]}
      empty={rows.length === 0} emptyTitle="No shop time in this period" emptyDescription="Putting a repair order in the shop starts the downtime clock; the time until it is completed shows up here.">
      {rows.slice(0, limit).map((r) => (
        <tr key={r.unitId}>
          <td><UnitCell unit={{ type: r.type, id: r.unitId, unitNumber: r.unitNumber }} /></td>
          <td className="num text-right text-fg-muted">{f.number(r.jobs)}</td>
          <td className={cn("num whitespace-nowrap text-right font-medium", r.days > 21 ? "text-danger" : r.days > 7 ? "text-warn" : "text-fg")}>{fmtDays(r.days)}</td>
          <td className="max-w-64 truncate" title={`${roLabel(r.longest.number)} · ${fmtDays(r.longest.days)} in this period`}>
            <RoLink id={r.longest.id} number={r.longest.number} title={r.longest.title} />
          </td>
          <td>{r.inShopNow ? <Badge value="SHOP" label="In shop" dot /> : <span className="text-[12px] text-fg-subtle">Back in service</span>}</td>
        </tr>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Driver charges and warranty claims                                  */
/* ------------------------------------------------------------------ */

export function DriverChargeTable({ f, money, rows }: Common & { rows: DriverChargeRow[] }) {
  return (
    <Table dense
      head={[
        "Driver", R("n", "Charges"), RT("t", "Told", "The driver has been told about the charge."),
        RT("nt", "Not told", "Nothing comes off a driver's pay until they have been told. Open the oldest to tell them."),
        ...(money ? [R("amt", "Total"), RT("nta", "Not told", "Amount of the charges the driver has not been told about.")] : []),
      ]}
      empty={rows.length === 0} emptyTitle="No driver charges in this period" emptyDescription="Repairs charged to a driver show here, with whether the driver has been told.">
      {rows.map((r) => (
        <tr key={r.driverId ?? "none"}>
          <td className="max-w-48 truncate">
            {r.driverId ? <Link href={driverHref(r.driverId)} className={cn("font-medium text-fg", linkCls)}>{r.name}</Link> : <span className="text-fg-subtle">{r.name}</span>}
          </td>
          <td className="num text-right text-fg-muted">{f.number(r.charges)}</td>
          <td className="num text-right text-fg-muted">{r.told || dash}</td>
          <td className="num whitespace-nowrap text-right">
            {r.notTold && r.oldestNotTold ? (
              <Link href={repairHref(r.oldestNotTold.id)} className="font-medium text-warn hover:underline" title={`Oldest: ${roLabel(r.oldestNotTold.number)}, ${f.date(r.oldestNotTold.at)}`}>{r.notTold}</Link>
            ) : dash}
          </td>
          {money && <td className="num text-right font-medium">{f.money(r.amount)}</td>}
          {money && <td className={cn("num text-right", r.notToldAmount ? "text-warn" : "text-fg-faint")}>{r.notToldAmount ? f.money(r.notToldAmount) : "—"}</td>}
        </tr>
      ))}
    </Table>
  );
}

export function WarrantyTable({ f, money, rows, limit = LIST_LIMIT }: Common & { rows: WarrantyRow[]; limit?: number }) {
  return (
    <Table dense
      head={["Repair order", "Unit", "Vendor", "Status", RT("d", "Days", "Open: days since the unit went in. Completed: days it took."), ...(money ? [R("amt", "Amount")] : [])]}
      empty={rows.length === 0} emptyTitle="No warranty claims" emptyDescription="Repair orders marked as a warranty claim show here until they are completed, so nothing that should be claimed back is forgotten.">
      {rows.slice(0, limit).map((r) => (
        <tr key={r.id}>
          <td className="max-w-56 truncate"><RoLink id={r.id} number={r.number} title={r.title} /></td>
          <td><UnitCell unit={r.unit} /></td>
          <td className="max-w-40 truncate text-fg-muted">{r.vendor ?? dash}</td>
          <td className="whitespace-nowrap">
            {r.open
              ? <Badge value={r.status} label={r.status === "IN_PROGRESS" ? (r.stage ? (REPAIR_STAGE_LABELS[r.stage] ?? humanize(r.stage)) : "In the shop") : "Scheduled"} />
              : <span className="text-[12px] text-fg-subtle">Completed {f.day(r.completedAt)}</span>}
          </td>
          <td className={cn("num text-right", r.open && r.daysOpen > 30 ? "font-medium text-warn" : "text-fg-muted")}>{r.daysOpen}</td>
          {money && <td className="num text-right">{r.amount ? f.money(r.amount) : dash}</td>}
        </tr>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Roadside inspections                                                */
/* ------------------------------------------------------------------ */

export function RoadsideLevelTable({ f, rows }: { f: Formatter; rows: LevelRow[] }) {
  return (
    <Table dense stickyHead={false} head={["Level", R("n", "Inspections"), R("v", "Violations"), RT("oos", "Out of service", "Inspections that put the driver or a unit out of service.")]}
      empty={rows.length === 0} emptyTitle="No DOT inspections in this period" emptyDescription="Record each DOT inspection report with its violations; levels, violations and out-of-service orders add up here.">
      {rows.map((r) => (
        <tr key={r.level}>
          <td className="whitespace-nowrap text-fg">{r.label}</td>
          <td className="num text-right text-fg-muted">{f.number(r.inspections)}</td>
          <td className="num text-right text-fg-muted">{r.violations || dash}</td>
          <td className={cn("num text-right", r.oos ? "font-medium text-danger" : "text-fg-faint")}>{r.oos || "—"}</td>
        </tr>
      ))}
    </Table>
  );
}

const RESULT_TONE: Record<string, "ok" | "warn" | "danger"> = { CLEAN: "ok", VIOLATIONS: "warn", OOS: "danger" };
const RESULT_LABEL: Record<string, string> = { CLEAN: "Clean", VIOLATIONS: "Violations", OOS: "Out of service" };

export function RoadsideList({ f, rows, now, limit = LIST_LIMIT }: { f: Formatter; rows: RoadsideRow[]; now: Date; limit?: number }) {
  const shown = [...rows].sort((a, b) => Number(b.oos) - Number(a.oos) || b.violations - a.violations || b.at.getTime() - a.at.getTime()).slice(0, limit);
  return (
    <Table dense stickyHead={false} head={["Inspection", "Driver", "Unit", "Result", "Correction"]}
      empty={rows.length === 0} emptyTitle="No DOT inspections in this period" emptyDescription="Record the next DOT inspection report; it lists here with its result and what has to be corrected.">
      {shown.map((r) => (
        <tr key={r.id}>
          <td className="whitespace-nowrap">
            <Link href={roadsideHref(r.id)} className={linkCls}>
              <span className="font-medium text-fg">{f.date(r.at)}</span>
              <span className="ml-1.5 text-[11px] text-fg-subtle">{r.reportNumber ?? r.levelLabel.split(" · ")[0]}</span>
            </Link>
            {r.place && <div className="max-w-44 truncate text-[11px] text-fg-subtle">{r.place}</div>}
          </td>
          <td className="max-w-36 truncate">{r.driver ? <Link href={driverHref(r.driver.id)} className={cn("text-fg", linkCls)}>{r.driver.name}</Link> : dash}</td>
          <td><UnitCell unit={r.unit} /></td>
          <td className="whitespace-nowrap">
            <Badge value={r.result} tone={r.oos ? "danger" : RESULT_TONE[r.result] ?? "neutral"} label={r.oos ? "Out of service" : (RESULT_LABEL[r.result] ?? humanize(r.result))} />
            {r.violations > 0 && <span className="num ml-1.5 text-[11px] text-fg-subtle">{plural(r.violations, "violation")}</span>}
          </td>
          <td className="whitespace-nowrap text-[12px]">
            {r.status === "OPEN" && r.correctionDueAt
              ? <span className={r.correctionDueAt < now ? "font-medium text-danger" : "text-fg-muted"}>Due {f.day(r.correctionDueAt)}</span>
              : <span className="text-fg-subtle">{r.status === "OPEN" ? "Open" : humanize(r.status)}</span>}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Paperwork today                                                     */
/* ------------------------------------------------------------------ */

function CountCell({ n, tone }: { n: number; tone: "danger" | "warn" | "info" }) {
  return <td className={cn("num text-right", n ? cn("font-medium", TONE_TEXT[tone]) : "text-fg-faint")}>{n || "—"}</td>;
}

export function PaperworkTable({ rows }: { rows: PaperworkGroup[] }) {
  return (
    <Table dense stickyHead={false}
      head={["", RT("x", "Expired", "Past the expiry date: renew first."), RT("s", "Expiring", "Expires within 30 days: book the renewal."), RT("m", "Missing", "Required document or date not on file."), R("ok", "Complete"), ""]}>
      {rows.map((r) => {
        const issues = r.expired + r.expiring + r.missing;
        return (
          <tr key={r.key}>
            <td className="whitespace-nowrap">
              <span className="inline-flex items-center gap-1 font-medium text-fg">{r.label}<InfoTip>{r.checks}.</InfoTip></span>
            </td>
            <CountCell n={r.expired} tone="danger" />
            <CountCell n={r.expiring} tone="warn" />
            <CountCell n={r.missing} tone="info" />
            <td className="num text-right text-fg-muted">{r.ok}<span className="text-fg-faint">/{r.total}</span></td>
            <td className="text-right">
              <Link href={r.href} className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">
                {issues ? "Fix" : "Open"}<ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
