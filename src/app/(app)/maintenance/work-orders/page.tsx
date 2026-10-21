import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { startOfMonth } from "date-fns";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, humanize } from "@/lib/constants";
import { date, money, number } from "@/lib/format";
import { Badge, Card, FilterPills, InfoTip, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { activeLoadsByUnit, daysBetween, str, unitsInShopCount, type ActiveLoad } from "../_lib/data";
import { newWorkOrderHref, workOrderHref, workOrdersHref } from "../_lib/links";
import { NO_VENDOR, onLoadReason, plural } from "../_lib/shared";
import { FilterBar } from "../_components/filter-bar";
import { Priority, UnitLink } from "../_components/unit-link";
import { WorkOrderStatusButtons } from "../_components/work-order-status";

export const metadata = { title: "Work orders" };

const ACTIVE = ["DRAFT", "OPEN", "IN_PROGRESS"] as const;
/** Working order for the active list: what is in the shop first, then what is booked, then drafts. */
const STATUS_RANK: Record<string, number> = { IN_PROGRESS: 0, OPEN: 1, DRAFT: 2 };
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
/** "All" groups rows: open work, then completed, then cancelled (each group keeps the query's newest-first order). */
const ALL_GROUP: Record<string, number> = { DRAFT: 0, OPEN: 0, IN_PROGRESS: 0, DONE: 1, CANCELLED: 2 };
/** How each status view is sorted, shown behind the (i) next to the pills. */
const SORT_NOTE: Record<string, string> = {
  active: "In progress first, then open and drafts; urgent work at the top of each group.",
  DONE: "Most recently completed first.",
  CANCELLED: "Most recently scheduled first.",
  all: "Open work first, then completed and cancelled; newest first in each group.",
};
const PAGE = 250;

export default async function WorkOrdersPage({ searchParams }: PageProps<"/maintenance/work-orders">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const sp = await searchParams;
  const statusParam = str(sp.status);
  const status = statusParam && (WORK_ORDER_STATUSES as readonly string[]).includes(statusParam) ? statusParam : statusParam === "all" ? "all" : "active";
  const priority = str(sp.priority);
  const category = str(sp.category);
  const unit = str(sp.unit);
  const validPriority = priority && (WORK_ORDER_PRIORITIES as readonly string[]).includes(priority) ? priority : undefined;
  const validCategory = category && (WORK_ORDER_CATEGORIES as readonly string[]).includes(category) ? category : undefined;
  const filtered = Boolean(validPriority || validCategory || unit);

  const where: Prisma.WorkOrderWhereInput = {
    ...(status === "active" ? { status: { in: [...ACTIVE] } } : status === "all" ? {} : { status }),
    ...(validPriority ? { priority: validPriority } : {}),
    ...(validCategory ? { category: validCategory } : {}),
    ...(unit ? { OR: [{ truckId: unit }, { trailerId: unit }] } : {}),
  };
  const finished = status === "DONE" || status === "CANCELLED" || status === "all";

  const [fetched, byStatus, urgent, month, trucks, trailers, unitsInShop] = await Promise.all([
    db.workOrder.findMany({
      where,
      orderBy: status === "CANCELLED" ? { scheduledAt: "desc" } : finished ? [{ completedAt: "desc" }, { scheduledAt: "desc" }] : { scheduledAt: "asc" },
      take: PAGE,
      include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } } },
    }),
    db.workOrder.groupBy({ by: ["status"], _count: true }),
    db.workOrder.count({ where: { priority: "URGENT", status: { in: [...ACTIVE] } } }),
    db.workOrder.aggregate({ where: { status: "DONE", completedAt: { gte: startOfMonth(new Date()) } }, _sum: { cost: true }, _count: true }),
    db.truck.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true, make: true, model: true } }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    unitsInShopCount(),
  ]);
  const rows = status === "all"
    ? [...fetched].sort((a, b) => (ALL_GROUP[a.status] ?? 9) - (ALL_GROUP[b.status] ?? 9))
    : finished
      ? fetched
      : [...fetched].sort((a, b) =>
          (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
          || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
          || a.scheduledAt.getTime() - b.scheduledAt.getTime());
  // Jobs that have not started yet, on a unit still out on a load: Start stays disabled until the load is recovered.
  const notStarted = (s: string) => s === "DRAFT" || s === "OPEN";
  const waitingUnits = [...new Set(rows.filter((w) => notStarted(w.status)).map((w) => w.truckId ?? w.trailerId).filter((v): v is string => Boolean(v)))];
  const loads = waitingUnits.length ? await activeLoadsByUnit(waitingUnits) : new Map<string, ActiveLoad>();
  const countOf = (s: string) => byStatus.find((c) => c.status === s)?._count ?? 0;
  const open = countOf("DRAFT") + countOf("OPEN");
  const inProgress = countOf("IN_PROGRESS");
  const total = byStatus.reduce((a, c) => a + c._count, 0);
  const pill = (key: string) => workOrdersHref({ status: key === "active" ? undefined : key, priority: validPriority, category: validCategory, unit });

  return (
    <>
      <PageHeader
        eyebrow="Fleet · Maintenance"
        title="Work orders"
        actions={
          <>
            <LinkButton href="/maintenance" variant="secondary">Maintenance overview</LinkButton>
            {editable && <LinkButton href={newWorkOrderHref()}><Plus />New work order</LinkButton>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open" value={open} tone={open ? "info" : "neutral"} hint={`${plural(countOf("DRAFT"), "draft")} · ${countOf("OPEN")} scheduled`} />
        <Stat label="In progress" value={inProgress} tone={inProgress ? "warn" : "ok"} hint={inProgress ? `${plural(unitsInShop, "unit")} in the shop` : "nothing in the shop"} />
        <Stat label="Urgent" value={urgent} tone={urgent ? "danger" : "ok"} hint={urgent ? "open or in progress" : "no urgent work open"} />
        <Stat label="Spend this month" value={money(month._sum.cost)} hint={`${month._count} completed since ${date(startOfMonth(new Date()))}`} />
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterPills active={status} items={[
              { key: "active", label: "Active", href: pill("active"), count: open + inProgress },
              ...WORK_ORDER_STATUSES.map((s) => ({ key: s, label: humanize(s), href: pill(s), count: countOf(s) })),
              { key: "all", label: "All", href: pill("all"), count: total },
            ]} />
            <InfoTip>{SORT_NOTE[status] ?? "Urgent work first, then the earliest scheduled."}</InfoTip>
          </div>
          <FilterBar align="right" keep={["status"]} filters={[
            { name: "priority", label: "Priority", value: validPriority ?? "", options: WORK_ORDER_PRIORITIES.map((p) => ({ value: p, label: humanize(p) })) },
            { name: "category", label: "Category", value: validCategory ?? "", options: WORK_ORDER_CATEGORIES.map((c) => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] ?? humanize(c) })) },
            { name: "unit", label: "Unit", value: unit ?? "", options: [
              ...trucks.map((t) => ({ value: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` })),
              ...trailers.map((t) => ({ value: t.id, label: `${t.unitNumber} · trailer` })),
            ] },
          ]} />
        </div>
        <Table head={["#", "Unit", "Work", "Category", "Priority",
          <span key="status" className="inline-flex items-center gap-1">Status<InfoTip>Starting a work order puts its unit in the shop; completing or cancelling it releases the unit.</InfoTip></span>,
          "Vendor", "Scheduled", "In / out", "Cost", ""]} empty={rows.length === 0}
          emptyTitle={status === "active" && !filtered ? "No open work orders" : "Nothing matches these filters"}
          emptyDescription={status === "active" && !filtered
            ? (editable ? "Create a work order for a repair, inspection or PM service, or start one from the PM schedule." : "Open work orders will appear here.")
            : "Clear a filter or pick another status."}>
          {rows.map((w) => {
            const shopDays = w.inAt ? daysBetween(w.inAt, w.outAt ?? undefined) : null;
            const unitId = w.truckId ?? w.trailerId;
            const load = notStarted(w.status) && unitId ? loads.get(unitId) : undefined;
            const unitNumber = w.truck?.unitNumber ?? w.trailer?.unitNumber;
            return (
              <tr key={w.id}>
                <td><Link href={workOrderHref(w.id)} className="num font-medium text-fg hover:underline">#{w.number}</Link></td>
                <td><UnitLink truck={w.truck} trailer={w.trailer} secondary={load ? <span className="text-warn">on <span className="num">{load.reference}</span></span> : undefined} /></td>
                <td className="max-w-80 truncate" title={w.description ?? undefined}>
                  <Link href={workOrderHref(w.id)} className="font-medium hover:underline">{w.title}</Link>
                </td>
                <td className="whitespace-nowrap text-fg-muted">{WORK_ORDER_CATEGORY_LABELS[w.category] ?? humanize(w.category)}</td>
                <td><Priority value={w.priority} /></td>
                <td><Badge value={w.status} dot /></td>
                <td className="max-w-44 truncate text-fg-muted">{w.vendor ?? <span className="text-fg-faint">{NO_VENDOR}</span>}</td>
                <td className="whitespace-nowrap text-fg-muted">{date(w.scheduledAt)}</td>
                <td className="whitespace-nowrap" title={shopDays != null ? `${number(shopDays)}d in the shop` : undefined}>
                  {w.inAt
                    ? <span className="num text-fg-muted">{date(w.inAt)} → {w.outAt ? date(w.outAt) : <span className="text-warn">in shop</span>}</span>
                    : <span className="text-fg-faint">—</span>}
                </td>
                <td className="num font-medium">{w.cost ? money(w.cost) : <span className="font-normal text-fg-faint">—</span>}</td>
                <td className="text-right">
                  {editable && <WorkOrderStatusButtons id={w.id} status={w.status} number={w.number} compact blockedBy={load && unitNumber ? onLoadReason(unitNumber, load.reference) : null} />}
                </td>
              </tr>
            );
          })}
        </Table>
        {rows.length >= PAGE && (
          <p className="border-t border-line bg-info-soft px-4 py-2 text-[12px] text-info">Showing the first {PAGE}. Narrow the filters to see the rest.</p>
        )}
      </Card>
    </>
  );
}
