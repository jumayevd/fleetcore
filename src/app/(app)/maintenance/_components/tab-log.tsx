import Link from "next/link";
import type { Prisma, Trailer, Truck } from "@prisma/client";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { REPAIR_TYPES, REPAIR_TYPE_LABELS, WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS } from "@/lib/constants";
import { Card, Table } from "@/components/ui";
import { RepairTags } from "@/components/shop/repair-bits";
import { downtime, durationText, linesSummary } from "@/components/shop/shared";
import { periodRange, PERIODS, type PeriodKey } from "../_lib/data";
import { newWorkOrderHref, vendorHref, workOrderHref } from "../_lib/links";
import { NO_VENDOR } from "../_lib/shared";
import { FilterBar } from "./filter-bar";
import { UnitLink } from "./unit-link";

/** `category` is the older grouping some report links still use; `vendor` is a shop name or "__none". */
export type LogFilters = { category?: string; type?: string; vendor?: string; unit?: string };

export async function LogTab({ period, trucks, trailers, filters, money }: { period: PeriodKey; trucks: Truck[]; trailers: Trailer[]; filters: LogFilters; money: boolean }) {
  const f = await getFormat();
  const r = periodRange(period);
  const category = filters.category && (WORK_ORDER_CATEGORIES as readonly string[]).includes(filters.category) ? filters.category : undefined;
  const type = filters.type && (REPAIR_TYPES as readonly string[]).includes(filters.type) ? filters.type : undefined;
  const where: Prisma.WorkOrderWhereInput = {
    status: "DONE",
    completedAt: { gte: r.from, lt: r.to },
    ...(category ? { category } : {}),
    ...(type ? { repairType: type } : {}),
    ...(filters.vendor ? { vendor: filters.vendor === "__none" ? null : filters.vendor } : {}),
    ...(filters.unit ? { OR: [{ truckId: filters.unit }, { trailerId: filters.unit }] } : {}),
  };
  const [rows, vendorRows] = await Promise.all([
    db.workOrder.findMany({
      where, orderBy: { completedAt: "desc" }, take: 300,
      include: {
        truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } }, createdBy: { select: { name: true } },
        vendorRef: { select: { id: true, name: true } }, lines: { orderBy: { position: "asc" }, select: { system: true, work: true } },
      },
    }),
    db.workOrder.groupBy({ by: ["vendor"], where: { status: "DONE", vendor: { not: null } }, orderBy: { vendor: "asc" } }),
  ]);

  const totalCost = rows.reduce((a, w) => a + w.cost, 0);
  const timed = rows.map((w) => downtime(w)).filter((d): d is NonNullable<typeof d> => d != null);
  const avgMs = timed.length ? timed.reduce((a, d) => a + d.ms, 0) / timed.length : null;

  const unitOptions = [
    ...trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` })),
    ...trailers.map((t) => ({ value: t.id, label: `${t.unitNumber} · trailer` })),
  ];
  const vendorOptions = [...vendorRows.filter((v) => v.vendor).map((v) => ({ value: v.vendor!, label: v.vendor! })), { value: "__none", label: NO_VENDOR }];
  const filtered = Boolean(category || type || filters.vendor || filters.unit);

  return (
    <Card flush title={<span>Completed repairs <span className="num ml-1 font-normal text-fg-subtle">{PERIODS[period].hint.toLowerCase()}</span></span>}>
      <div className="border-b border-line px-4 pb-3">
        <FilterBar keep={["tab", "period"]} filters={[
          { name: "type", label: "Repair type", value: type ?? "", options: REPAIR_TYPES.map((t) => ({ value: t, label: REPAIR_TYPE_LABELS[t] })) },
          ...(category ? [{ name: "category", label: "Category", value: category, options: WORK_ORDER_CATEGORIES.map((c) => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] })) }] : []),
          { name: "vendor", label: "Shop", value: filters.vendor ?? "", options: vendorOptions },
          { name: "unit", label: "Unit", value: filters.unit ?? "", options: unitOptions },
        ]} />
      </div>
      <Table head={["Repair", "Unit", "What was done", "Shop", "In", "Back", "Downtime", ...(money ? ["Cost"] : []), "Logged by"]} empty={rows.length === 0}
        emptyTitle="No completed repairs in this window"
        emptyDescription={filtered ? "Clear a filter or widen the period to see more." : "Completed repairs appear here. Switch the period above, or log a repair that is already done."}>
        {rows.map((w) => {
          const d = downtime(w);
          const summary = linesSummary(w.lines);
          return (
            <tr key={w.id}>
              <td className="whitespace-nowrap"><Link href={workOrderHref(w.id)} className="num font-medium text-fg hover:underline">{roLabel(w.number)}</Link></td>
              <td><UnitLink truck={w.truck} trailer={w.trailer} /></td>
              <td className="max-w-80">
                <Link href={workOrderHref(w.id)} className="block truncate font-medium hover:underline" title={summary || w.title}>{w.title}</Link>
                {summary && <p className="truncate text-[11px] text-fg-subtle">{summary}</p>}
                <RepairTags w={w} className="mt-1" />
              </td>
              <td className="max-w-44 truncate text-fg-muted">
                {w.vendorRef ? <Link href={vendorHref(w.vendorRef.id)} className="hover:text-fg hover:underline">{w.vendorRef.name}</Link> : w.vendor ?? <span className="text-fg-faint">{NO_VENDOR}</span>}
              </td>
              <td className="num whitespace-nowrap text-fg-muted">{f.date(w.inAt)}</td>
              <td className="num whitespace-nowrap text-fg-muted">{f.date(w.outAt ?? w.completedAt)}</td>
              <td className="num">{d ? d.text : <span className="text-fg-faint">—</span>}</td>
              {money && <td className="num font-medium">{f.money(w.cost)}</td>}
              <td className="whitespace-nowrap text-fg-muted">{w.createdBy?.name ?? <span className="text-fg-faint">—</span>}</td>
            </tr>
          );
        })}
        {rows.length > 1 && (
          <tr className="bg-sunken/60 font-medium hover:bg-sunken/60">
            <td colSpan={6} className="text-[12px] text-fg-muted">Total · {f.number(rows.length)} repairs</td>
            <td className="num text-fg-muted" title="Average per repair with in and back times">{avgMs != null ? `avg ${durationText(avgMs)}` : "—"}</td>
            {money && <td className="num">{f.money(totalCost)}</td>}
            <td />
          </tr>
        )}
      </Table>
      {rows.length === 0 && (
        <div className="flex justify-center border-t border-line px-4 py-3">
          <Link href={newWorkOrderHref({ status: "DONE" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Log a completed repair</Link>
        </div>
      )}
    </Card>
  );
}
