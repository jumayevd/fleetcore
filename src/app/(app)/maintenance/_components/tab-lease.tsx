import Link from "next/link";
import type { Truck } from "@prisma/client";
import { km, money, money2, number } from "@/lib/format";
import { Badge, Card, InfoTip, Progress, Stat, Table } from "@/components/ui";
import { leaseRows, leaseTone } from "../_lib/data";
import { truckHref } from "../_lib/links";
import { plural } from "../_lib/shared";

export function LeaseTab({ trucks }: { trucks: Truck[] }) {
  const { rows, totals } = leaseRows(trucks);
  const nearCap = rows.filter((r) => r.over === 0 && r.remaining < 5000).length;
  const lessors = new Set(rows.map((r) => r.truck.lessor).filter(Boolean)).size;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leased trucks" value={rows.length}
          hint={!rows.length ? "none on lease" : lessors ? plural(lessors, "lessor") : "no lessor recorded"} />
        <Stat label="Over cap" value={totals.overCount} tone={totals.overCount ? "danger" : "ok"} hint={totals.overCount ? `${km(totals.over)} over in total` : "all within the hard cap"} />
        <Stat label="Within 5,000 km of cap" value={nearCap} tone={nearCap ? "warn" : "neutral"} hint="route shorter lanes or rotate units" />
        <Stat label="Penalty exposure" value={money(totals.exposure)} tone={totals.exposure ? "danger" : "neutral"} hint="over km × overage rate, today" />
      </div>

      <Card className="mt-4" flush title="Lease mileage">
        <Table head={["Lessor", "Unit", "Lease start", "Odometer", "Annual limit", "Buffer",
          <span key="cap" className="inline-flex items-center gap-1">Hard cap<InfoTip>Lease start + annual limit × (1 + buffer).</InfoTip></span>,
          "Remaining", "Overage rate", "Exposure"]} empty={rows.length === 0}
          emptyTitle="No leased trucks" emptyDescription="Set a truck's ownership to Leased and fill in the lease start km, annual limit and overage rate to track its cap here.">
          {rows.map((r) => {
            const tone = leaseTone(r);
            return (
              <tr key={r.truck.id}>
                <td className="whitespace-nowrap text-fg-muted">{r.truck.lessor ?? <span className="text-fg-faint">—</span>}</td>
                <td title={`${r.truck.make} ${r.truck.model}`}>
                  <Link href={truckHref(r.truck.id)} className="num font-medium text-fg hover:underline">{r.truck.unitNumber}</Link>
                </td>
                <td className="num text-fg-muted">{km(r.startKm)}</td>
                <td className="num">{km(r.truck.odometerKm)}</td>
                <td className="num text-fg-muted">{km(r.limitKm)}</td>
                <td className="num text-fg-muted">{r.bufferPct}%</td>
                <td className="num">{km(r.cap)}</td>
                <td className="min-w-44">
                  {r.over > 0
                    ? <Badge value="OVERDUE" tone="danger" label={`${number(r.over)} km over`} className="num" />
                    : tone === "warn"
                      ? <Badge value="HIGH" tone="warn" label={`${number(r.remaining)} km left`} className="num" />
                      : <span className="num text-fg-muted">{number(r.remaining)} km left</span>}
                  <Progress value={Math.min(1, r.used)} tone={tone} className="mt-1.5 w-40" />
                </td>
                <td className="num text-fg-muted">{r.rate ? `${money2(r.rate)}/km` : <span className="text-fg-faint">—</span>}</td>
                <td className={r.exposure ? "num font-medium text-danger" : "num text-fg-faint"}>{r.exposure ? money(r.exposure) : "—"}</td>
              </tr>
            );
          })}
          {rows.length > 1 && (
            <tr className="bg-sunken/60 font-medium hover:bg-sunken/60">
              <td colSpan={2} className="text-[12px] text-fg-muted">Total · {rows.length} trucks</td>
              <td />
              <td className="num">{km(totals.driven)} <span className="text-[11px] font-normal text-fg-subtle">driven on lease</span></td>
              <td className="num">{km(totals.limit)}</td>
              <td colSpan={2} />
              <td className={totals.over ? "num text-danger" : "num text-fg-muted"}>{totals.over ? `${number(totals.over)} km over` : "all under cap"}</td>
              <td />
              <td className={totals.exposure ? "num text-danger" : "num text-fg-muted"}>{money(totals.exposure)}</td>
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}
