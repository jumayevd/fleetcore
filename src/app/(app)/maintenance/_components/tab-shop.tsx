import Link from "next/link";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Badge, Card, Table } from "@/components/ui";
import { RepairDue, RepairTags } from "@/components/shop/repair-bits";
import { downtime, downtimeTone, stageLabel } from "@/components/shop/shared";
import { countUnits } from "../_lib/data";
import { vendorHref, workOrderHref, workOrdersHref } from "../_lib/links";
import { NO_VENDOR, plural } from "../_lib/shared";
import { UnitLink } from "./unit-link";

export async function ShopTab({ money }: { money: boolean }) {
  const f = await getFormat();
  const now = new Date().getTime();
  const rows = (await db.workOrder.findMany({
    where: { status: "IN_PROGRESS", voidedAt: null },
    include: {
      truck: { select: { id: true, unitNumber: true, status: true } }, trailer: { select: { id: true, unitNumber: true, status: true } },
      vendorRef: { select: { id: true, name: true, phone: true } },
    },
  }))
    .map((w) => ({ ...w, clock: downtime(w, now) }))
    .sort((a, b) => (b.clock?.ms ?? 0) - (a.clock?.ms ?? 0));
  const stuck = rows.filter((r) => (r.clock?.ms ?? 0) > 7 * 86_400_000).length;
  const committed = rows.reduce((a, r) => a + (r.invoiceTotal ?? r.cost), 0);
  // Two jobs on one truck are still one unit off the road.
  const units = countUnits(rows);
  const jobs = rows.length === units ? "" : ` · ${plural(rows.length, "repair")}`;
  const todayStart = f.startOfDay().getTime();

  return (
    <Card flush title="In the shop now"
      actions={rows.length > 0 && <span className="num text-[11px] text-fg-subtle">{plural(units, "unit")}{jobs}{money ? ` · ${f.money(committed)} so far` : ""}{stuck ? ` · ${stuck} over a week` : ""}</span>}>
      <Table head={["Unit", "Repair", "Stage", "Shop", "In since", "Downtime", "Promised", ...(money ? ["Cost so far"] : [])]} empty={rows.length === 0}
        emptyTitle="Nothing in the shop" emptyDescription="Every unit is available. A repair put in the shop shows here until it is closed out.">
        {rows.map((w) => {
          const tone = w.clock ? downtimeTone(w.clock.ms) : "neutral";
          return (
            <tr key={w.id}>
              <td>
                <div className="flex items-center gap-2">
                  <UnitLink truck={w.truck} trailer={w.trailer} />
                  <Badge value={(w.truck ?? w.trailer)?.status ?? "—"} />
                </div>
              </td>
              <td className="max-w-80">
                <Link href={workOrderHref(w.id)} className="block truncate font-medium hover:underline"><span className="num text-fg-subtle">{roLabel(w.number)}</span> {w.title}</Link>
                <RepairTags w={w} className="mt-1" />
              </td>
              <td className="whitespace-nowrap text-fg-muted">{stageLabel(w.stage) ?? "—"}</td>
              <td className="max-w-44 truncate text-fg-muted">
                {w.vendorRef ? <Link href={vendorHref(w.vendorRef.id)} className="hover:text-fg hover:underline">{w.vendorRef.name}</Link> : w.vendor ?? <span className="text-fg-faint">{NO_VENDOR}</span>}
              </td>
              <td className="num whitespace-nowrap text-fg-muted">{f.dateTime(w.inAt)}</td>
              <td>{w.clock ? (tone === "neutral" ? <span className="num text-fg-muted">{w.clock.text}</span> : <Badge value="SHOP" tone={tone} label={w.clock.text} className="num" />) : "—"}</td>
              <td><RepairDue w={w} f={f} now={now} todayStart={todayStart} /></td>
              {money && <td className="num">{f.money(w.invoiceTotal ?? w.cost)}</td>}
            </tr>
          );
        })}
      </Table>
      {rows.length > 0 && (
        <div className="flex justify-end border-t border-line px-4 py-2">
          <Link href={workOrdersHref({ status: "shop" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open in Repairs</Link>
        </div>
      )}
    </Card>
  );
}
