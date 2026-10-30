import Link from "next/link";
import type { ReactNode } from "react";
import { Download, Plus, UserRoundX } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { PAYERS, PAYER_LABELS, REPAIR_STAGES, REPAIR_STAGE_LABELS, REPAIR_TYPES, REPAIR_TYPE_LABELS } from "@/lib/constants";
import { Card, FilterPills, InfoTip, LinkButton, PageHeader, Segmented, Stat, Table, buttonClass, cardClass } from "@/components/ui";
import { ActionButton } from "@/components/shop/action-button";
import { RepairDue, RepairStatus, RepairTags } from "@/components/shop/repair-bits";
import { driverNotTold, linesSummary } from "@/components/shop/shared";
import { markDriverInformed } from "@/app/actions/repairs";
import { newWorkOrderHref, vendorHref, withQuery, workOrderHref, workOrdersHref } from "../_lib/links";
import { plural } from "../_lib/shared";
import {
  filterQuery, notToldWhere, parseRepairFilters, repairCounts, repairRowInclude, repairWhere, sortRepairs, unitDriver, REPAIR_VIEW_LABELS, type RepairFilters, type RepairView,
} from "../_lib/repairs";
import { FilterBar } from "../_components/filter-bar";
import { SearchBox } from "../_components/search-box";
import { UnitLink } from "../_components/unit-link";

export const metadata = { title: "Repairs" };

const PAGE = 250;

export default async function RepairsPage({ searchParams }: PageProps<"/maintenance/work-orders">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const filters = parseRepairFilters(await searchParams);
  const now = new Date();
  const todayStart = f.startOfDay(now);

  const [fetched, counts, notTold, vendors, typedShops, unitRow] = await Promise.all([
    db.workOrder.findMany({ where: repairWhere(filters, now, todayStart), include: repairRowInclude, take: PAGE, orderBy: { createdAt: "desc" } }),
    repairCounts(now, todayStart),
    db.workOrder.findMany({
      where: notToldWhere, orderBy: { createdAt: "asc" }, take: 5,
      select: { id: true, number: true, title: true, cost: true, invoiceTotal: true, chargeDriver: { select: { name: true } }, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } },
    }),
    db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.workOrder.groupBy({ by: ["vendor"], where: { vendorId: null, vendor: { not: null } }, orderBy: { vendor: "asc" } }),
    filters.unit
      ? db.truck.findUnique({ where: { id: filters.unit }, select: { unitNumber: true } }).then(async (t) => {
          if (t) return { unitNumber: t.unitNumber, type: "truck" as const };
          const tr = await db.trailer.findUnique({ where: { id: filters.unit }, select: { unitNumber: true } });
          return tr ? { unitNumber: tr.unitNumber, type: "trailer" as const } : null;
        })
      : null,
  ]);
  const rows = sortRepairs(fetched, filters.view);
  const nowMs = now.getTime();
  const href = (patch: Partial<RepairFilters>) => workOrdersHref(filterQuery({ ...filters, ...patch }));
  const exportHref = withQuery("/api/export/repairs", filterQuery(filters));
  const narrowed = Boolean(filters.kind || filters.shop || filters.unit || filters.type || filters.payer || filters.q || filters.told || filters.stage);

  const tile = (view: RepairView, node: ReactNode) => (
    <Link href={href({ view, told: undefined })} aria-current={filters.view === view ? "true" : undefined}
      className="block rounded-lg transition-shadow hover:shadow-lift focus-visible:outline-2 focus-visible:outline-accent aria-[current=true]:ring-2 aria-[current=true]:ring-accent/40">
      {node}
    </Link>
  );
  // All comes first and is where the page opens.
  const pills: { key: string; label: string; href: string; count?: number }[] = [
    { key: "all", label: "All", href: href({ view: "all" }), count: counts.all },
    { key: "active", label: "Active", href: href({ view: "active" }), count: counts.active },
    { key: "completed", label: "Completed", href: href({ view: "completed" }), count: counts.completed },
  ];
  if (!["active", "completed", "all"].includes(filters.view)) pills.splice(1, 0, { key: filters.view, label: REPAIR_VIEW_LABELS[filters.view], href: href({}) });

  const emptyTitle = narrowed ? "Nothing matches these filters"
    : filters.view === "all" ? "No repairs yet"
      : filters.view === "active" ? "No repairs open" : `No ${REPAIR_VIEW_LABELS[filters.view].toLowerCase()} repairs`;
  const emptyDescription = narrowed
    ? "Clear a filter or the search to see more."
    : editable ? "Create a repair to book a unit into a shop, or log work that is already done." : "Repair orders will appear here as the shop team opens them.";

  return (
    <>
      <PageHeader
        title="Repairs"
        subtitle={unitRow ? <>Repairs on <span className="num font-medium text-fg">{unitRow.unitNumber}</span> · <Link href={href({ unit: undefined })} className="hover:text-fg hover:underline">all units</Link></> : "Repair orders from booking to invoice."}
        actions={
          <>
            <a href={exportHref} className={buttonClass("secondary")} download><Download />Export</a>
            {editable && <LinkButton href={newWorkOrderHref(unitRow && filters.unit ? { [unitRow.type]: filters.unit } : {})}><Plus />New repair</LinkButton>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tile("active", <Stat label="Active" value={counts.active} hint="Scheduled or in the shop" />)}
        {tile("scheduled", <Stat label="Scheduled" value={counts.scheduled} tone={counts.scheduled ? "info" : "neutral"} hint="Booked into a shop, unit still in service" />)}
        {tile("shop", <Stat label="In the shop" value={counts.shop} tone={counts.shop ? "warn" : "ok"} hint={counts.shop ? `${plural(counts.shop, "unit")} off the road` : "nothing off the road"} />)}
        {tile("completed", <Stat label="Completed" value={counts.completed} tone="ok" hint="Done and back in service" />)}
        {tile("overdue", <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? "danger" : "ok"} hint={counts.overdue ? "past the promised date, or booked and not in" : "everything on time"} />)}
      </div>

      {counts.notTold > 0 && (
        <section className={`${cardClass} mt-4 border-warn/30 bg-warn-soft`} aria-label="Driver charges not told">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <UserRoundX className="h-4 w-4 text-warn" aria-hidden />
              {plural(counts.notTold, "repair")} charged to a driver who has not been told
              <InfoTip>Nothing comes off a driver&apos;s pay until they have been told about the charge.</InfoTip>
            </p>
            {counts.notTold > notTold.length || filters.told !== "no"
              ? <Link href={href({ told: "no", view: "all" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Show {counts.notTold > notTold.length ? `all ${counts.notTold}` : "them"}</Link>
              : null}
          </div>
          <ul className="divide-y divide-line px-4 pb-1">
            {notTold.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
                <Link href={workOrderHref(w.id)} className="num font-medium text-fg hover:underline">{roLabel(w.number)}</Link>
                <span className="num unit-no text-fg-muted">{w.truck?.unitNumber ?? w.trailer?.unitNumber ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">{w.title}</span>
                <span className="font-medium text-fg">{w.chargeDriver?.name ?? <span className="text-warn">No driver picked</span>}</span>
                {money && <span className="num text-fg-muted">{f.money(w.invoiceTotal ?? w.cost)}</span>}
                {editable && w.chargeDriver && <ActionButton action={markDriverInformed.bind(null, w.id)} pendingText="Saving…">Driver told</ActionButton>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterPills active={filters.view} items={pills} />
            <Segmented active={filters.kind ?? "any"} items={[
              { key: "any", label: "All units", href: href({ kind: undefined }) },
              { key: "truck", label: "Trucks", href: href({ kind: "truck" }) },
              { key: "trailer", label: "Trailers", href: href({ kind: "trailer" }) },
            ]} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox action="/maintenance/work-orders" q={filters.q} keep={filterQuery(filters)} placeholder="Search RO, unit, driver, shop" />
            <FilterBar align="right" keep={["status", "kind", "q", "unit"]} filters={[
              { name: "shop", label: "Shop", value: filters.shop ?? "", options: [
                ...vendors.map((v) => ({ value: v.id, label: v.name })),
                ...typedShops.filter((t) => t.vendor).map((t) => ({ value: `t:${t.vendor}`, label: `${t.vendor} (typed)` })),
                { value: "none", label: "No shop recorded" },
              ] },
              { name: "type", label: "Repair type", value: filters.type ?? "", options: REPAIR_TYPES.map((t) => ({ value: t, label: REPAIR_TYPE_LABELS[t] })) },
              { name: "payer", label: "Who pays", value: filters.payer ?? "", options: PAYERS.map((p) => ({ value: p, label: PAYER_LABELS[p] })) },
              { name: "stage", label: "Stage in the shop", value: filters.stage ?? "", options: REPAIR_STAGES.map((s) => ({ value: s, label: REPAIR_STAGE_LABELS[s] })) },
              { name: "told", label: "Driver charges", value: filters.told ?? "", options: [{ value: "no", label: "Driver not told" }] },
            ]} />
          </div>
        </div>
        <Table
          head={["Repair", "Unit", "Work", "Shop", "Status", filters.view === "completed" ? "Completed" : "Due", ...(money ? ["Cost"] : []), ""]}
          empty={rows.length === 0} emptyTitle={emptyTitle} emptyDescription={emptyDescription}>
          {rows.map((w) => {
            const driver = w.payer === "DRIVER" && w.chargeDriver ? w.chargeDriver : unitDriver(w);
            const summary = linesSummary(w.lines);
            const amount = w.invoiceTotal ?? w.cost;
            return (
              <tr key={w.id} className={w.voidedAt ? "opacity-60" : undefined}>
                <td className="whitespace-nowrap">
                  <Link href={workOrderHref(w.id)} className="num font-medium text-fg hover:underline">{roLabel(w.number)}</Link>
                  <p className="num text-[11px] text-fg-subtle">{f.day(w.createdAt)}</p>
                </td>
                <td><UnitLink truck={w.truck} trailer={w.trailer} secondary={driver?.name} /></td>
                <td className="max-w-96">
                  <Link href={workOrderHref(w.id)} className="block truncate font-medium text-fg hover:underline" title={summary || w.title}>{w.title}</Link>
                  {summary && <p className="truncate text-[11px] text-fg-subtle" title={summary}>{summary}</p>}
                  <RepairTags w={w} className="mt-1" />
                </td>
                <td className="max-w-52">
                  {w.vendorRef ? (
                    <>
                      <Link href={vendorHref(w.vendorRef.id)} className="block truncate text-fg hover:underline">{w.vendorRef.name}</Link>
                      {(w.vendorRef.phone || w.vendorRef.contactName) && <p className="truncate text-[11px] text-fg-subtle">{[w.vendorRef.contactName, w.vendorRef.phone].filter(Boolean).join(" · ")}</p>}
                    </>
                  ) : w.vendor ? <span className="block truncate text-fg-muted" title="Typed on the order; not linked to a vendor yet">{w.vendor}</span> : <span className="text-fg-faint">No shop</span>}
                </td>
                <td><RepairStatus w={w} now={nowMs} /></td>
                <td><RepairDue w={w} f={f} now={nowMs} todayStart={todayStart.getTime()} /></td>
                {money && <td className="num whitespace-nowrap font-medium">{amount ? f.money(amount) : <span className="font-normal text-fg-faint">—</span>}</td>}
                <td className="text-right">
                  {editable && driverNotTold(w) && w.chargeDriverId && <ActionButton action={markDriverInformed.bind(null, w.id)}>Driver told</ActionButton>}
                </td>
              </tr>
            );
          })}
        </Table>
        {rows.length >= PAGE && (
          <p className="border-t border-line bg-info-soft px-4 py-2 text-[12px] text-info">Showing the newest {PAGE}. Narrow the filters or search to see the rest; Export has every row.</p>
        )}
      </Card>
    </>
  );
}
