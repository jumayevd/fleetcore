import Link from "next/link";
import type { Prisma, Trailer, Truck } from "@prisma/client";
import { db } from "@/lib/db";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";
import { date, money, number } from "@/lib/format";
import { Card, Table } from "@/components/ui";
import { daysBetween, periodRange, PERIODS, type PeriodKey } from "../_lib/data";
import { newWorkOrderHref, workOrderHref } from "../_lib/links";
import { NO_VENDOR } from "../_lib/shared";
import { FilterBar } from "./filter-bar";
import { UnitLink } from "./unit-link";

export type LogFilters = { category?: string; vendor?: string; unit?: string };

export async function LogTab({ period, trucks, trailers, filters }: { period: PeriodKey; trucks: Truck[]; trailers: Trailer[]; filters: LogFilters }) {
  const r = periodRange(period);
  const category = filters.category && (WORK_ORDER_CATEGORIES as readonly string[]).includes(filters.category) ? filters.category : undefined;
  const where: Prisma.WorkOrderWhereInput = {
    status: "DONE",
    completedAt: { gte: r.from, lt: r.to },
    ...(category ? { category } : {}),
    ...(filters.vendor ? { vendor: filters.vendor === "__none" ? null : filters.vendor } : {}),
    ...(filters.unit ? { OR: [{ truckId: filters.unit }, { trailerId: filters.unit }] } : {}),
  };
  const [rows, vendorRows] = await Promise.all([
    db.workOrder.findMany({
      where, orderBy: { completedAt: "desc" }, take: 300,
      include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } }, createdBy: { select: { name: true } } },
    }),
    db.workOrder.findMany({ where: { status: "DONE", vendor: { not: null } }, distinct: ["vendor"], select: { vendor: true }, orderBy: { vendor: "asc" } }),
  ]);

  const totals = rows.reduce((a, w) => {
    const d = w.inAt && w.outAt ? daysBetween(w.inAt, w.outAt) : null;
    return { parts: a.parts + w.partsCost, labor: a.labor + w.laborCost, cost: a.cost + w.cost, days: a.days + (d ?? 0), timed: a.timed + (d == null ? 0 : 1) };
  }, { parts: 0, labor: 0, cost: 0, days: 0, timed: 0 });

  const unitOptions = [
    ...trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` })),
    ...trailers.map((t) => ({ value: t.id, label: `${t.unitNumber} · trailer` })),
  ];
  const vendorOptions = [...vendorRows.map((v) => ({ value: v.vendor!, label: v.vendor! })), { value: "__none", label: NO_VENDOR }];

  return (
    <Card flush
      title={<span>Completed work <span className="num ml-1 font-normal text-fg-subtle">{PERIODS[period].hint.toLowerCase()}</span></span>}>
      <div className="border-b border-line px-4 pb-3">
        <FilterBar keep={["tab", "period"]} filters={[
          { name: "category", label: "Category", value: category ?? "", options: WORK_ORDER_CATEGORIES.map((c) => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] ?? humanize(c) })) },
          { name: "vendor", label: "Vendor", value: filters.vendor ?? "", options: vendorOptions },
          { name: "unit", label: "Unit", value: filters.unit ?? "", options: unitOptions },
        ]} />
      </div>
      <Table head={["Unit", "Category", "Work", "Vendor", "In", "Out", "Days", "Parts", "Labour", "Cost", "Logged by"]} empty={rows.length === 0}
        emptyTitle="No completed work in this window"
        emptyDescription={category || filters.vendor || filters.unit ? "Clear a filter or widen the period to see more records." : "Completed work orders appear here. Switch the period above, or log a repair that is already done."}>
        {rows.map((w) => {
          const days = w.inAt && w.outAt ? daysBetween(w.inAt, w.outAt) : null;
          return (
            <tr key={w.id}>
              <td><UnitLink truck={w.truck} trailer={w.trailer} /></td>
              <td className="whitespace-nowrap text-fg-muted">{WORK_ORDER_CATEGORY_LABELS[w.category] ?? humanize(w.category)}</td>
              <td className="max-w-72 truncate" title={`#${w.number} · ${w.title}`}>
                <Link href={workOrderHref(w.id)} className="font-medium hover:underline">{w.title}</Link>
              </td>
              <td className="max-w-44 truncate text-fg-muted">{w.vendor ?? <span className="text-fg-faint">{NO_VENDOR}</span>}</td>
              <td className="whitespace-nowrap text-fg-muted">{date(w.inAt)}</td>
              <td className="whitespace-nowrap text-fg-muted">{date(w.outAt ?? w.completedAt)}</td>
              <td className="num">{days == null ? <span className="text-fg-faint">—</span> : days}</td>
              <td className="num text-fg-muted">{money(w.partsCost)}</td>
              <td className="num text-fg-muted">{money(w.laborCost)}</td>
              <td className="num font-medium">{money(w.cost)}</td>
              <td className="whitespace-nowrap text-fg-muted">{w.createdBy?.name ?? <span className="text-fg-faint">—</span>}</td>
            </tr>
          );
        })}
        {rows.length > 1 && (
          <tr className="bg-sunken/60 font-medium hover:bg-sunken/60">
            <td colSpan={6} className="text-[12px] text-fg-muted">Total · {number(rows.length)} records</td>
            <td className="num text-fg-muted">{totals.timed ? (totals.days / totals.timed).toFixed(1) : "—"}</td>
            <td className="num">{money(totals.parts)}</td>
            <td className="num">{money(totals.labor)}</td>
            <td className="num">{money(totals.cost)}</td>
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
