import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { TruckCostRow } from "@/lib/stats";
import { money, number } from "@/lib/format";
import { Badge, InfoTip, Progress, Table, cn } from "@/components/ui";
import { UnitLink } from "@/app/(app)/maintenance/_components/unit-link";
import { maintenanceHref, workOrderHref } from "@/app/(app)/maintenance/_lib/links";
import type { CategoryRow, ComplianceGroup, ReportData, VendorRow } from "./data";
import { HIGH_COST_PER_KM, HIGH_L100, MIN_KM_TO_COMPARE, TONE_TEXT, fmtDays, fmtL100, fmtPerKm, type ReportPeriod } from "./shared";

const R = (key: string, label: string) => <span key={key} className="block text-right">{label}</span>;
/** Right-aligned header with an explanation on hover. */
const RT = (key: string, label: string, tip: string) => <span key={key} className="flex items-center justify-end gap-1">{label}<InfoTip>{tip}</InfoTip></span>;
const dash = <span className="text-fg-faint">—</span>;
const totalRow = "bg-sunken/60 font-medium hover:bg-sunken/60";

/** Rows shown for the ranked tables; the CSV export has every row. */
export const VENDOR_LIMIT = 8;
export const DOWNTIME_LIMIT = 10;

/* ------------------------------------------------------------------ */
/* Cost per truck                                                      */
/* ------------------------------------------------------------------ */

export function TruckCostTable({ rows, totals, trailers, period, fleetCostPerKm }: {
  rows: TruckCostRow[];
  totals: ReportData["truckTotals"];
  trailers: ReportData["trailerWork"];
  period: ReportPeriod;
  /** Fleet running cost per km, to flag expensive trucks. */
  fleetCostPerKm: number | null;
}) {
  const avgL100 = totals.l100;
  const comparable = (r: TruckCostRow) => r.km >= MIN_KM_TO_COMPARE;
  const truckCostPerKm = totals.km > 0 ? totals.total / totals.km : null;
  return (
    <Table className="max-h-[560px]" dense
      head={[
        "Truck",
        RT("km", "Km driven", "Highest odometer reading in the period minus the last one before it (fuel fills, work orders, current odometer). A dash: fewer than two readings, so log the odometer with the next fill."),
        RT("fuel", "Fuel", "Fuel fills logged in the period."),
        RT("l100", "L/100 km", `Litres filled ÷ km driven × 100. Orange when ${Math.round((HIGH_L100 - 1) * 100)}% or more above the fleet average (trucks with ${number(MIN_KM_TO_COMPARE)} km or more).`),
        RT("maint", "Maintenance", "Completed work orders on the truck in the period. Opens its repair log."),
        R("total", "Total"),
        RT("cpk", "Cost/km", `Fuel + maintenance ÷ km driven. Orange when ${HIGH_COST_PER_KM}× the fleet's cost per km or more.`),
      ]}
      empty={rows.length === 0} emptyTitle="No trucks yet" emptyDescription="Add trucks to the fleet; their fuel, maintenance and km driven are compared here.">
      {rows.map((r) => {
        const highBurn = avgL100 != null && r.l100 != null && comparable(r) && r.l100 >= avgL100 * HIGH_L100;
        const highCost = fleetCostPerKm != null && r.costPerKm != null && comparable(r) && r.costPerKm >= fleetCostPerKm * HIGH_COST_PER_KM;
        return (
          <tr key={r.id}>
            <td className="whitespace-nowrap">
              <div className="flex items-center gap-1.5">
                <UnitLink truck={{ id: r.id, unitNumber: r.unitNumber }} secondary={r.model} />
                {r.status !== "ACTIVE" && <Badge value={r.status} />}
              </div>
            </td>
            <td className="num text-right text-fg-muted" title={r.km ? undefined : "No odometer readings to compare in this period"}>{r.km ? number(r.km) : dash}</td>
            <td className="num text-right" title={r.fills ? `${r.fills} ${r.fills === 1 ? "fill" : "fills"} · ${number(Math.round(r.liters))} L` : "No fuel logged in this period"}>{r.fuel ? money(r.fuel) : dash}</td>
            <td className={cn("num text-right", highBurn ? "font-medium text-warn" : "text-fg-muted")}
              title={highBurn && avgL100 != null ? `${Math.round((r.l100! / avgL100 - 1) * 100)}% above the fleet average of ${fmtL100(avgL100)}` : undefined}>
              {r.l100 != null ? r.l100.toFixed(1) : dash}
            </td>
            <td className="num whitespace-nowrap text-right">
              {r.jobs ? (
                <Link href={maintenanceHref({ tab: "log", period, unit: r.id })} className="hover:underline" title={`${r.jobs} completed ${r.jobs === 1 ? "work order" : "work orders"}: open the repair log`}>
                  {money(r.maintenance)} <span className="text-[11px] text-fg-subtle">· {r.jobs}</span>
                </Link>
              ) : dash}
            </td>
            <td className="num text-right font-medium">{r.total ? money(r.total) : dash}</td>
            <td className={cn("num text-right", highCost ? "font-medium text-warn" : "text-fg")}
              title={highCost && fleetCostPerKm != null ? `${(r.costPerKm! / fleetCostPerKm).toFixed(1)}× the fleet's ${fmtPerKm(fleetCostPerKm)} per km` : undefined}>
              {fmtPerKm(r.costPerKm)}
            </td>
          </tr>
        );
      })}
      {trailers.jobs > 0 && (
        <tr>
          <td className="whitespace-nowrap">
            <Link href="/fleet/trailers" className="font-medium text-fg hover:underline">Trailers</Link>
            <div className="text-[11px] text-fg-subtle">maintenance only</div>
          </td>
          <td className="text-right">{dash}</td>
          <td className="text-right">{dash}</td>
          <td className="text-right">{dash}</td>
          <td className="num whitespace-nowrap text-right">{money(trailers.maintenance)} <span className="text-[11px] text-fg-subtle">· {trailers.jobs}</span></td>
          <td className="num text-right font-medium">{money(trailers.maintenance)}</td>
          <td className="text-right">{dash}</td>
        </tr>
      )}
      {rows.length > 1 && (
        <tr className={totalRow}>
          <td className="text-[12px] text-fg-muted">Fleet · {number(rows.length)} trucks{trailers.jobs > 0 ? " + trailers" : ""}</td>
          <td className="num text-right">{number(totals.km)}</td>
          <td className="num text-right">{money(totals.fuel)}</td>
          <td className="num text-right" title="Average over trucks with both fuel and km in the period">{avgL100 != null ? avgL100.toFixed(1) : "—"}</td>
          <td className="num text-right">{money(totals.maintenance + trailers.maintenance)}</td>
          <td className="num text-right">{money(totals.total + trailers.maintenance)}</td>
          <td className="num text-right" title={truckCostPerKm != null ? `Trucks only: ${fmtPerKm(truckCostPerKm)}` : undefined}>{fmtPerKm(fleetCostPerKm)}</td>
        </tr>
      )}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance by category / vendor                                    */
/* ------------------------------------------------------------------ */

function ShareCell({ value }: { value: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Progress value={value / 100} tone="progress" className="w-16" />
      <span className="num w-8 text-right text-fg-muted">{value}%</span>
    </div>
  );
}

export function CategoryTable({ rows, period, spend }: { rows: CategoryRow[]; period: ReportPeriod; spend: number }) {
  const jobs = rows.reduce((a, r) => a + r.jobs, 0);
  return (
    <Table dense head={["Category", R("n", "Jobs"), R("cost", "Spend"), RT("share", "Share", "Of the period's maintenance spend."), R("avg", "Avg per job")]}
      empty={rows.length === 0} emptyTitle="No completed work in this period" emptyDescription="Complete work orders (or log a repair that is already done) to see where the money goes. Try a longer period.">
      {rows.map((r) => (
        <tr key={r.category}>
          <td className="whitespace-nowrap">
            <Link href={maintenanceHref({ tab: "log", period, category: r.category })} className="font-medium text-fg hover:underline" title="Open these jobs in the repair log">{r.label}</Link>
          </td>
          <td className="num text-right text-fg-muted">{number(r.jobs)}</td>
          <td className="num text-right font-medium">{money(r.cost)}</td>
          <td><ShareCell value={r.share} /></td>
          <td className="num text-right text-fg-muted">{money(r.avg)}</td>
        </tr>
      ))}
      {rows.length > 1 && (
        <tr className={totalRow}>
          <td className="text-[12px] text-fg-muted">All categories</td>
          <td className="num text-right">{number(jobs)}</td>
          <td className="num text-right">{money(spend)}</td>
          <td />
          <td className="num text-right">{money(jobs ? spend / jobs : 0)}</td>
        </tr>
      )}
    </Table>
  );
}

export function VendorTable({ rows, period, limit = VENDOR_LIMIT }: { rows: VendorRow[]; period: ReportPeriod; limit?: number }) {
  return (
    <Table dense head={["Vendor / shop", R("n", "Jobs"), R("cost", "Spend"), RT("share", "Share", "Of the period's maintenance spend."), R("avg", "Avg per job")]}
      empty={rows.length === 0} emptyTitle="No completed work in this period" emptyDescription="Vendors appear once their work orders are completed. Record the shop on each work order to compare them.">
      {rows.slice(0, limit).map((r) => (
        <tr key={r.label}>
          <td className="max-w-56 truncate">
            <Link href={maintenanceHref({ tab: "log", period, vendor: r.vendor ?? "__none" })} title="Open these jobs in the repair log"
              className={cn("hover:underline", r.vendor ? "font-medium text-fg" : "text-fg-subtle")}>{r.label}</Link>
          </td>
          <td className="num text-right text-fg-muted">{number(r.jobs)}</td>
          <td className="num text-right font-medium">{money(r.cost)}</td>
          <td><ShareCell value={r.share} /></td>
          <td className="num text-right text-fg-muted">{money(r.avg)}</td>
        </tr>
      ))}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Downtime per unit                                                   */
/* ------------------------------------------------------------------ */

export function DowntimeTable({ rows, limit = DOWNTIME_LIMIT }: { rows: ReportData["downtime"]; limit?: number }) {
  return (
    <Table dense head={["Unit", R("n", "Jobs"), RT("days", "In shop", "Days in the shop inside the period, from each work order's in and out times. Two jobs on the unit at once count once."), "Longest job", "Now"]}
      empty={rows.length === 0} emptyTitle="No shop time in this period" emptyDescription="Starting a work order puts its unit in the shop; the time until it is completed shows up here.">
      {rows.slice(0, limit).map((r) => (
        <tr key={r.unitId}>
          <td><UnitLink truck={r.type === "truck" ? { id: r.unitId, unitNumber: r.unitNumber } : null} trailer={r.type === "trailer" ? { id: r.unitId, unitNumber: r.unitNumber } : null} /></td>
          <td className="num text-right text-fg-muted">{r.jobs}</td>
          <td className={cn("num whitespace-nowrap text-right font-medium", r.days > 21 ? "text-danger" : r.days > 7 ? "text-warn" : "text-fg")}>{fmtDays(r.days)}</td>
          <td className="max-w-56 truncate" title={`#${r.longest.number} · ${fmtDays(r.longest.days)} in this period`}>
            <Link href={workOrderHref(r.longest.id)} className="hover:underline"><span className="num text-fg-subtle">#{r.longest.number}</span> {r.longest.title}</Link>
          </td>
          <td>{r.inShopNow ? <Badge value="SHOP" label="In shop" dot /> : <span className="text-[12px] text-fg-subtle">Back in service</span>}</td>
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

export function ComplianceTable({ rows }: { rows: ComplianceGroup[] }) {
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
