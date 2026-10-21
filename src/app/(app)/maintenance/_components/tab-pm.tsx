import Link from "next/link";
import { Wrench } from "lucide-react";
import { date, km, money, number } from "@/lib/format";
import { Badge, Card, InfoTip, LinkButton, Progress, Stat, Table } from "@/components/ui";
import { pmTone, type PmRow } from "../_lib/data";
import { newWorkOrderHref, truckHref, workOrderHref } from "../_lib/links";
import { NO_VENDOR } from "../_lib/shared";

export function PmTab({ rows, editable }: { rows: PmRow[]; editable: boolean }) {
  const overdue = rows.filter((r) => r.kmLeft != null && r.kmLeft < 0);
  const dueSoon = rows.filter((r) => r.kmLeft != null && r.kmLeft >= 0 && r.kmLeft <= 2000);
  const upcoming = rows.filter((r) => r.kmLeft != null && r.kmLeft > 2000 && r.kmLeft <= 5000);
  const unknown = rows.filter((r) => r.kmLeft == null);
  const totalOverdueKm = overdue.reduce((a, r) => a + -(r.kmLeft ?? 0), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "ok"} hint={overdue.length ? `${km(totalOverdueKm)} past due in total` : "no truck past its interval"} />
        <Stat label="Due within 2,000 km" value={dueSoon.length} tone={dueSoon.length ? "warn" : "neutral"} hint="book the shop this week" />
        <Stat label="Due within 5,000 km" value={upcoming.length} tone="info" hint="plan the shop visit and parts ahead" />
        <Stat label="Tracked trucks" value={rows.length} hint={unknown.length ? `${unknown.length} without a last PM reading` : "every truck has a PM baseline"} />
      </div>

      <Card className="mt-4" flush title={<span className="flex items-center gap-1.5">PM schedule<InfoTip>Sorted by kilometres left to the next service, overdue first.</InfoTip></span>}>
        <Table head={["Unit", "Group", "Last PM", "Last PM job", "Odometer", "Interval", "Next service", "Km left", ""]} empty={rows.length === 0}
          emptyTitle="No active trucks" emptyDescription="Trucks appear here once they are added to the fleet.">
          {rows.map((r) => {
            const t = r.truck;
            const tone = pmTone(r.kmLeft);
            const label = r.kmLeft == null ? "No baseline" : r.kmLeft < 0 ? `${number(-r.kmLeft)} km overdue` : `${number(r.kmLeft)} km`;
            return (
              <tr key={t.id}>
                <td title={`${t.make} ${t.model}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <Link href={truckHref(t.id)} className="num font-medium text-fg hover:underline">{t.unitNumber}</Link>
                    {t.status !== "ACTIVE" && <Badge value={t.status} />}
                  </span>
                </td>
                <td className="text-fg-muted">{t.group ?? <span className="text-fg-faint">—</span>}</td>
                <td className="whitespace-nowrap text-fg-muted" title={t.lastPmKm != null ? `At ${km(t.lastPmKm)}` : "No odometer reading"}>{date(t.lastPmAt)}</td>
                <td className="max-w-48 truncate" title={r.lastJob ? r.lastJob.vendor ?? NO_VENDOR : undefined}>
                  {r.lastJob ? (
                    <Link href={workOrderHref(r.lastJob.id)} className="hover:underline">
                      <span className="num font-medium">{r.lastJob.cost ? money(r.lastJob.cost) : "No cost"}</span> <span className="num text-fg-subtle">#{r.lastJob.number}</span>
                    </Link>
                  ) : <span className="text-fg-faint">—</span>}
                </td>
                <td className="num">{km(t.odometerKm)}</td>
                <td className="num text-fg-muted">{km(t.pmIntervalKm)}</td>
                <td className="num text-fg-muted">{r.nextService != null ? km(r.nextService) : <span className="text-fg-faint">—</span>}</td>
                <td className="min-w-44">
                  <div className="flex items-center gap-2">
                    {tone === "ok" || tone === "neutral" ? <span className="num text-fg-muted">{label}</span> : <Badge value="PM" tone={tone} label={label} className="num" />}
                  </div>
                  {r.used != null && <Progress value={Math.min(1, r.used)} tone={tone === "neutral" ? "neutral" : tone} className="mt-1.5 w-40" />}
                </td>
                <td className="text-right">
                  {r.openPm ? (
                    <Link href={workOrderHref(r.openPm.id)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted hover:text-fg">
                      <Wrench className="h-3.5 w-3.5" />PM <span className="num">#{r.openPm.number}</span> <Badge value={r.openPm.status} />
                    </Link>
                  ) : editable ? (
                    <LinkButton href={newWorkOrderHref({ truck: t.id, category: "PM" })} size="sm" variant={tone === "danger" || tone === "warn" ? "primary" : "secondary"}>
                      <Wrench />Create PM work order
                    </LinkButton>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
