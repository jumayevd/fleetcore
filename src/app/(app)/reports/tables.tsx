import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DRIVER_TYPE_SHORT, DRIVER_TYPE_LABELS } from "@/lib/constants";
import { money, number } from "@/lib/format";
import { Chip, InfoTip, Table, cn } from "@/components/ui";
import type { ClaimRow, DriverRow, LaneRow, TruckRow } from "./data";
import { TONE_TEXT, emptyTone, fmtPerKm, marginTone, onTimeTone, scoreTone } from "./shared";

const R = (key: string, label: string) => <span key={key} className="block text-right">{label}</span>;
/** Right-aligned header with an explanation on hover. */
const RT = (key: string, label: string, tip: string) => <span key={key} className="flex items-center justify-end gap-1">{label}<InfoTip>{tip}</InfoTip></span>;

/** Lanes shown on the page; the card header says when there are more (the CSV has them all). */
export const LANE_LIMIT = 25;

export function LaneTable({ rows, limit = LANE_LIMIT }: { rows: LaneRow[]; limit?: number }) {
  const shown = rows.slice(0, limit);
  return (
    <Table dense head={["Lane", R("n", "Loads"), R("km", "Km · empty"), R("rev", "Revenue"), R("m", "Margin"), R("rpk", "$/km"), R("e", "Empty")]}
      empty={rows.length === 0} emptyTitle="No completed loads in this period" emptyDescription="Lane figures appear once loads are delivered. Try a longer period.">
      {shown.map((l) => (
        <tr key={l.lane}>
          <td className="whitespace-nowrap font-medium text-fg"><span className="inline-flex items-center gap-1">{l.origin}<ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />{l.dest}</span></td>
          <td className="num text-right text-fg-muted">{l.loads}</td>
          <td className="num whitespace-nowrap text-right text-fg-muted">{number(l.km)} <span className="text-fg-subtle">· {number(l.emptyKm)}</span></td>
          <td className="num text-right font-medium">{money(l.revenue)}</td>
          <td className={cn("num whitespace-nowrap text-right", TONE_TEXT[marginTone(l.marginPct)])}>{money(l.margin)} <span className="text-[11px]">· {l.marginPct}%</span></td>
          <td className="num text-right text-fg-muted">{fmtPerKm(l.perKm)}</td>
          <td className={cn("num text-right", TONE_TEXT[emptyTone(l.emptyPct)])}>{l.emptyPct}%</td>
        </tr>
      ))}
    </Table>
  );
}

export function DriverTable({ rows }: { rows: DriverRow[] }) {
  return (
    <Table dense head={["Driver", R("n", "Loads"), R("km", "Km"), R("ot", "On time"), R("rev", "Revenue"), R("pay", "Earnings"), R("s", "Score")]}
      empty={rows.length === 0} emptyTitle="No driver activity in this period" emptyDescription="Drivers appear here once their loads are delivered.">
      {rows.map((d) => (
        <tr key={d.id}>
          <td className="whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <Link href={`/drivers/${d.id}`} className="font-medium text-fg hover:underline">{d.name}</Link>
              <Chip title={DRIVER_TYPE_LABELS[d.type] ?? d.type}>{DRIVER_TYPE_SHORT[d.type] ?? d.type}</Chip>
            </span>
          </td>
          <td className="num text-right text-fg-muted">{d.loads}</td>
          <td className="num text-right text-fg-muted">{number(d.km)}</td>
          <td className={cn("num text-right", TONE_TEXT[onTimeTone(d.onTimePct)])}>{d.onTimePct}%</td>
          <td className="num text-right font-medium">{money(d.revenue)}</td>
          <td className="num text-right text-fg-muted">{money(d.earnings)}</td>
          <td className={cn("num text-right font-medium", TONE_TEXT[scoreTone(d.score)])}>{d.score}</td>
        </tr>
      ))}
    </Table>
  );
}

export function TruckTable({ rows }: { rows: TruckRow[] }) {
  return (
    <Table dense head={["Truck", "Ownership", R("n", "Loads"), R("km", "Km"), R("rev", "Revenue"), R("wo", "Work orders"),
      RT("cpk", "Cost/km", "Driver pay, fuel, other load costs and work orders per km run."),
      RT("rpk", "$/km", "Revenue per km run, loaded and empty. Red when it does not cover the cost per km.")]}
      empty={rows.length === 0} emptyTitle="No truck activity in this period" emptyDescription="Trucks appear here once their loads are delivered.">
      {rows.map((t) => (
        <tr key={t.id}>
          <td className="whitespace-nowrap">
            <Link href={`/fleet/${t.id}`} title={t.model ?? undefined} className="num font-medium text-fg hover:underline">{t.unit}</Link>
          </td>
          <td className="whitespace-nowrap text-fg-muted">{t.ownership}</td>
          <td className="num text-right text-fg-muted">{t.loads}</td>
          <td className="num text-right text-fg-muted">{number(t.km)}</td>
          <td className="num text-right font-medium">{money(t.revenue)}</td>
          <td className="num whitespace-nowrap text-right text-fg-muted" title={t.workOrders ? `${t.workOrders} completed work ${t.workOrders === 1 ? "order" : "orders"} in this period` : "No completed work orders in this period"}>
            {t.workOrderCost ? money(t.workOrderCost) : <span className="text-fg-faint">—</span>}{t.workOrders > 0 && <span className="text-[11px] text-fg-subtle"> · {t.workOrders}</span>}
          </td>
          <td className="num text-right text-fg-muted">{fmtPerKm(t.costPerKm)}</td>
          <td className={cn("num text-right", t.perKm != null && t.costPerKm != null && t.costPerKm >= t.perKm ? "font-medium text-danger" : "text-fg")}>{fmtPerKm(t.perKm)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ClaimsTable({ rows }: { rows: ClaimRow[] }) {
  const tot = rows.reduce((a, r) => ({ count: a.count + r.count, open: a.open + r.open, claimed: a.claimed + r.claimed, settled: a.settled + r.settled }), { count: 0, open: 0, claimed: 0, settled: 0 });
  return (
    <Table dense head={["Claim type", R("n", "Claims"), R("o", "Open"), R("c", "Claimed"), R("s", "Settled")]}
      empty={rows.length === 0} emptyTitle="No claims in this period" emptyDescription="Cargo, equipment and liability claims with an incident date in the period are summarised here.">
      {rows.map((r) => (
        <tr key={r.type}>
          <td className="font-medium text-fg">{r.label}</td>
          <td className="num text-right text-fg-muted">{r.count}</td>
          <td className={cn("num text-right", r.open ? "font-medium text-warn" : "text-fg-faint")}>{r.open || "—"}</td>
          <td className="num text-right text-fg">{money(r.claimed)}</td>
          <td className="num text-right text-fg-muted">{r.settled ? money(r.settled) : <span className="text-fg-faint">—</span>}</td>
        </tr>
      ))}
      {rows.length > 1 && (
        <tr className="bg-sunken font-medium">
          <td className="text-fg">All types</td>
          <td className="num text-right">{tot.count}</td>
          <td className={cn("num text-right", tot.open ? "text-warn" : "text-fg-faint")}>{tot.open || "—"}</td>
          <td className="num text-right">{money(tot.claimed)}</td>
          <td className="num text-right">{tot.settled ? money(tot.settled) : "—"}</td>
        </tr>
      )}
    </Table>
  );
}
