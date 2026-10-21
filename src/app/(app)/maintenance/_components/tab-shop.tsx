import Link from "next/link";
import { db } from "@/lib/db";
import { WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";
import { date, money } from "@/lib/format";
import { Badge, Card, Table } from "@/components/ui";
import { countUnits, daysBetween, shopTone } from "../_lib/data";
import { workOrderHref, workOrdersHref } from "../_lib/links";
import { NO_VENDOR, plural } from "../_lib/shared";
import { Priority, UnitLink } from "./unit-link";
import { WorkOrderStatusButtons } from "./work-order-status";

export async function ShopTab({ editable }: { editable: boolean }) {
  const rows = (await db.workOrder.findMany({
    where: { status: "IN_PROGRESS" },
    include: { truck: { select: { id: true, unitNumber: true, status: true } }, trailer: { select: { id: true, unitNumber: true, status: true } } },
  }))
    .map((w) => ({ ...w, since: w.inAt ?? w.scheduledAt, days: daysBetween(w.inAt ?? w.scheduledAt) }))
    .sort((a, b) => b.days - a.days);
  const stuck = rows.filter((r) => r.days > 7).length;
  const committed = rows.reduce((a, r) => a + r.cost, 0);
  // Two jobs on one truck are still one unit off the road.
  const units = countUnits(rows);
  const jobs = rows.length === units ? "" : ` · ${plural(rows.length, "job")}`;

  return (
    <Card flush title="In the shop now"
      actions={rows.length > 0 && <span className="num text-[11px] text-fg-subtle">{plural(units, "unit")}{jobs} · {money(committed)} committed{stuck ? ` · ${stuck} over a week` : ""}</span>}>
      <Table head={["Unit", "Work order", "Priority", "Vendor", "Since", "Days", "Cost so far", ""]} empty={rows.length === 0}
        emptyTitle="Nothing in the shop" emptyDescription="Every unit is available. Starting a work order moves its unit here until the work is done.">
        {rows.map((w) => (
          <tr key={w.id}>
            <td>
              <div className="flex items-center gap-2">
                <UnitLink truck={w.truck} trailer={w.trailer} />
                <Badge value={(w.truck ?? w.trailer)?.status ?? "—"} />
              </div>
            </td>
            <td className="max-w-80 truncate" title={`#${w.number} · ${WORK_ORDER_CATEGORY_LABELS[w.category] ?? humanize(w.category)}`}>
              <Link href={workOrderHref(w.id)} className="font-medium hover:underline">{w.title}</Link>
            </td>
            <td><Priority value={w.priority} /></td>
            <td className="max-w-44 truncate text-fg-muted">{w.vendor ?? <span className="text-fg-faint">{NO_VENDOR}</span>}</td>
            <td className="whitespace-nowrap text-fg-muted">{date(w.since)}</td>
            <td>{w.days > 7 ? <Badge value="SHOP" tone={shopTone(w.days)} label={`${w.days}d`} className="num" /> : <span className="num text-fg-muted">{w.days}d</span>}</td>
            <td className="num">{money(w.cost)}</td>
            <td className="text-right">{editable && <WorkOrderStatusButtons id={w.id} status={w.status} number={w.number} compact />}</td>
          </tr>
        ))}
      </Table>
      {rows.length > 0 && (
        <div className="flex justify-end border-t border-line px-4 py-2">
          <Link href={workOrdersHref({ status: "IN_PROGRESS" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open in work orders</Link>
        </div>
      )}
    </Card>
  );
}
