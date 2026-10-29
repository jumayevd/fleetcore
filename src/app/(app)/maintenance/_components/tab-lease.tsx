import Link from "next/link";
import type { Truck } from "@prisma/client";
import { getFormat } from "@/lib/format-server";
import { Badge, Card, InfoTip, Progress, Stat, Table } from "@/components/ui";
import { leaseRows, leaseTone } from "../_lib/data";
import { truckHref } from "../_lib/links";
import { plural } from "../_lib/shared";

/** How close to its cap a leased truck has to be before it is flagged, in the company's distance unit. */
const NEAR_CAP = 5000;

export async function LeaseTab({ trucks, money }: { trucks: Truck[]; money: boolean }) {
  const f = await getFormat();
  const { rows, totals } = leaseRows(trucks);
  const nearCap = rows.filter((r) => r.over === 0 && r.remaining < NEAR_CAP).length;
  const lessors = new Set(rows.map((r) => r.truck.lessor).filter(Boolean)).size;
  const u = f.labels.distance;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leased trucks" value={rows.length} hint={!rows.length ? "none on lease" : lessors ? plural(lessors, "lessor") : "no lessor recorded"} />
        <Stat label="Over cap" value={totals.overCount} tone={totals.overCount ? "danger" : "ok"} hint={totals.overCount ? `${f.dist(totals.over)} over in total` : "all within the hard cap"} />
        <Stat label={`Within ${f.dist(NEAR_CAP)} of cap`} value={nearCap} tone={nearCap ? "warn" : "neutral"} hint="rotate units or plan the lease return" />
        {money
          ? <Stat label="Penalty exposure" value={f.money(totals.exposure)} tone={totals.exposure ? "danger" : "neutral"} hint={`distance over × overage rate, today`} />
          : <Stat label="Driven on lease" value={f.dist(totals.driven)} />}
      </div>

      <Card className="mt-4" flush title="Lease mileage">
        <Table head={["Lessor", "Unit", "Lease start", "Odometer", "Annual limit", "Buffer",
          <span key="cap" className="inline-flex items-center gap-1">Hard cap<InfoTip>Lease start + annual limit × (1 + buffer).</InfoTip></span>,
          "Remaining", ...(money ? ["Overage rate", "Exposure"] : [])]} empty={rows.length === 0}
          emptyTitle="No leased trucks" emptyDescription={`Set a truck's ownership to Leased and fill in the lease start (${u}), annual limit and overage rate to track its cap here.`}>
          {rows.map((r) => {
            const tone = leaseTone(r);
            return (
              <tr key={r.truck.id}>
                <td className="whitespace-nowrap text-fg-muted">{r.truck.lessor ?? <span className="text-fg-faint">—</span>}</td>
                <td title={`${r.truck.make} ${r.truck.model}`}><Link href={truckHref(r.truck.id)} className="num unit-no font-medium text-fg hover:underline">{r.truck.unitNumber}</Link></td>
                <td className="num text-fg-muted">{f.dist(r.startKm)}</td>
                <td className="num">{f.dist(r.truck.odometerKm)}</td>
                <td className="num text-fg-muted">{f.dist(r.limitKm)}</td>
                <td className="num text-fg-muted">{r.bufferPct}%</td>
                <td className="num">{f.dist(r.cap)}</td>
                <td className="min-w-44">
                  {r.over > 0
                    ? <Badge value="OVERDUE" tone="danger" label={`${f.dist(r.over)} over`} className="num" />
                    : tone === "warn"
                      ? <Badge value="HIGH" tone="warn" label={`${f.dist(r.remaining)} left`} className="num" />
                      : <span className="num text-fg-muted">{f.dist(r.remaining)} left</span>}
                  <Progress value={Math.min(1, r.used)} tone={tone} className="mt-1.5 w-40" />
                </td>
                {money && <td className="num text-fg-muted">{r.rate ? `${f.money2(r.rate)} ${f.labels.perDistance}` : <span className="text-fg-faint">—</span>}</td>}
                {money && <td className={r.exposure ? "num font-medium text-danger" : "num text-fg-faint"}>{r.exposure ? f.money(r.exposure) : "—"}</td>}
              </tr>
            );
          })}
          {rows.length > 1 && (
            <tr className="bg-sunken/60 font-medium hover:bg-sunken/60">
              <td colSpan={2} className="text-[12px] text-fg-muted">Total · {rows.length} trucks</td>
              <td />
              <td className="num">{f.dist(totals.driven)} <span className="text-[11px] font-normal text-fg-subtle">driven on lease</span></td>
              <td className="num">{f.dist(totals.limit)}</td>
              <td colSpan={2} />
              <td className={totals.over ? "num text-danger" : "num text-fg-muted"}>{totals.over ? `${f.dist(totals.over)} over` : "all under cap"}</td>
              {money && <td />}
              {money && <td className={totals.exposure ? "num text-danger" : "num text-fg-muted"}>{f.money(totals.exposure)}</td>}
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}
