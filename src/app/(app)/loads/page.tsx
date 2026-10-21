import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { ArrowRight, ChevronLeft, ChevronRight, Download, LayoutGrid, List, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BILLING_STAGE_LABELS, LOAD_STATUSES, LOAD_STATUS_LABELS, humanize, type BillingStage, type LoadStatus } from "@/lib/constants";
import { money, dateTime, number } from "@/lib/format";
import { estimatedArrival } from "@/lib/telemetry";
import { Badge, Card, Cell, Chip, FilterPills, LinkButton, PageHeader, STATUS_TONE, Segmented, Stat, Table, buttonClass, cn } from "@/components/ui";
import { BOARD_COLUMN_CAP, LIST_INCLUDE, PAGE_SIZE, hasActiveFilters, loadWhere, loadsHref, parseLoadFilters, periodLabel, type LoadFilters } from "./query";
import { BOARD_COLUMNS, PRIORITY_TONE, fmtRpk, lateness, ratePerKm } from "./shared";
import { LoadFilterBar } from "./filters";
import { LoadRowMenu } from "./row-menu";
import { LoadBoard } from "./board";

export const metadata = { title: "Loads" };

/** One query per board column so every column gets its own cap (the board shows at most BOARD_COLUMN_CAP cards each). */
function boardColumns(where: Prisma.LoadWhereInput) {
  return Promise.all(BOARD_COLUMNS.map(async (status) => {
    const w: Prisma.LoadWhereInput = { AND: [where, { status }] };
    const [loads, total] = await Promise.all([
      db.load.findMany({
        where: w, take: BOARD_COLUMN_CAP, include: LIST_INCLUDE,
        // Work waiting to happen: soonest pickup first. Deliveries: most recent first.
        orderBy: status === "DELIVERED" ? { deliveredAt: "desc" } : { pickupAt: "asc" },
      }),
      db.load.count({ where: w }),
    ]);
    return { status, loads, total };
  }));
}

export default async function LoadsPage({ searchParams }: PageProps<"/loads">) {
  const user = await requireUser("loads.view");
  const f = parseLoadFilters(await searchParams);
  const board = f.view === "board";
  const canEdit = can(user.role, "loads.edit");
  const canClaim = can(user.role, "claims.edit");
  const showMoney = can(user.role, "finance.view") || canEdit;
  const where = loadWhere(f);
  // Soonest first when triaging booked / dispatched work; otherwise newest pickups first.
  const asc = board || f.status === "PLANNED" || f.status === "ASSIGNED";

  const [loads, columns, total, byStatus, kpi, parties, teams] = await Promise.all([
    board ? [] : db.load.findMany({ where, orderBy: [{ pickupAt: asc ? "asc" : "desc" }, { id: "asc" }], take: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE, include: LIST_INCLUDE }),
    board ? boardColumns(where) : [],
    db.load.count({ where }),
    db.load.groupBy({ by: ["status"], where: loadWhere({ ...f, view: "table" }, { withStatus: false }), _count: true }),
    db.load.aggregate({
      where: { AND: [where, { status: { not: "CANCELLED" } }] },
      _count: true, _sum: { rate: true, distanceKm: true, emptyKm: true, driverPay: true, fuelCost: true, otherCost: true },
    }),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A stale link past the last page (filters narrowed since) lands on the last page instead of an empty table.
  if (!board && f.page > pages) redirect(loadsHref(f, { page: String(pages) }));

  const countOf = (s: string) => byStatus.find((c) => c.status === s)?._count ?? 0;
  const allCount = byStatus.reduce((a, c) => a + c._count, 0);
  const sum = kpi._sum;
  const revenue = sum.rate ?? 0;
  const loaded = sum.distanceKm ?? 0;
  const empty = sum.emptyKm ?? 0;
  const totalKm = loaded + empty;
  const cost = (sum.driverPay ?? 0) + (sum.fuelCost ?? 0) + (sum.otherCost ?? 0);
  const marginPct = revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0;
  const emptyPct = totalKm ? Math.round((empty / totalKm) * 100) : 0;
  const billable = kpi._count;
  const period = periodLabel(f);

  const party = (c: { id: string; name: string }) => ({ id: c.id, label: c.name });
  const customers = parties.filter((c) => c.kind !== "BROKER").map(party);
  const brokers = parties.filter((c) => c.kind !== "SHIPPER").map(party);

  return (
    <>
      <PageHeader
        eyebrow="Dispatch"
        title="Loads"
        subtitle={`${number(total)} ${total === 1 ? "load" : "loads"}${hasActiveFilters(f) ? " match the current filters" : ""} · ${period}`}
        actions={
          <>
            <Segmented active={f.view} items={[
              { key: "table", href: loadsHref(f, { view: undefined }), label: <><List className="h-3.5 w-3.5" />Table</> },
              { key: "board", href: loadsHref(f, { view: "board", status: undefined }), label: <><LayoutGrid className="h-3.5 w-3.5" />Board</> },
            ]} />
            <LinkButton href={loadsHref({ ...f, view: "table" }, {}, "/loads/export")} variant="secondary" prefetch={false} title="Download these loads as CSV"><Download className="h-4 w-4" />Export</LinkButton>
            {canEdit && <LinkButton href="/loads/new"><Plus className="h-4 w-4" />New load</LinkButton>}
          </>
        }
      />

      <div className={cn("mb-4 grid grid-cols-2 gap-3", showMoney ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-3")}>
        <Stat label="Loads" value={number(total)} hint={`${number(countOf("PLANNED") + countOf("ASSIGNED") + countOf("IN_TRANSIT"))} active · ${number(countOf("DELIVERED") + countOf("INVOICED"))} completed`} />
        {showMoney && <Stat label="Revenue" value={money(revenue)} hint={`${marginPct}% margin after driver, fuel and other costs`} tone={marginPct < 15 ? "warn" : "ok"} />}
        {showMoney && <Stat label="Avg rate" value={money(billable ? revenue / billable : 0)} hint={`per load, ${number(billable)} billable`} />}
        {showMoney && <Stat label="Avg $/km" value={fmtRpk(ratePerKm(revenue, loaded, empty))} hint="revenue over loaded + empty km" />}
        <Stat label="Empty km" value={`${emptyPct}%`} hint={`${number(empty)} of ${number(totalKm)} km`} tone={emptyPct > 20 ? "warn" : emptyPct > 12 ? "neutral" : "ok"} />
        {!showMoney && <Stat label="Loaded km" value={number(loaded)} hint={`${number(billable)} loads excl. cancelled`} />}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Keyed on the URL so the search box resets when the filters change underneath it (back button, pills). */}
        <LoadFilterBar key={loadsHref(f)} values={f} teams={teams} customers={customers} brokers={brokers} />
        {!board && (
          <FilterPills active={f.status ?? "ALL"} items={[
            { key: "ALL", href: loadsHref(f, { status: undefined }), label: "All", count: allCount },
            ...LOAD_STATUSES.map((s) => ({ key: s, href: loadsHref(f, { status: s }), label: LOAD_STATUS_LABELS[s], count: countOf(s) })),
          ]} />
        )}
      </div>

      {board ? (
        <LoadBoard
          columns={columns.map((c) => ({ ...c, moreHref: loadsHref(f, { view: undefined, status: c.status }) }))}
          showMoney={showMoney} canEdit={canEdit}
        />
      ) : (
        <Card flush>
          <Table dense
            head={[
              "Load", "Status", "Customer", "Route", "Pickup", "Delivery", "Driver / truck",
              <span key="km" className="block text-right" title="Loaded km · empty km">Km</span>,
              ...(showMoney ? [<span key="rate" className="block text-right">Rate</span>, <span key="rpk" className="block text-right">$/km</span>] : []),
              "",
            ]}
            empty={loads.length === 0}
            emptyTitle={hasActiveFilters(f) ? "No loads match these filters" : "No loads yet"}
            emptyDescription={hasActiveFilters(f) ? "Widen the date range, clear the status pill or search for something else." : canEdit ? "Book the first load with “New load” — stops, cargo and pricing take about a minute." : "Loads appear here once a dispatcher books them."}
          >
            {loads.map((l) => {
              const status = l.status as LoadStatus;
              const eta = status === "IN_TRANSIT" ? estimatedArrival(l) : null;
              const late = lateness(l, eta);
              const stops = l._count.stops;
              return (
                <tr key={l.id}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <Link href={`/loads/${l.id}`} className="num font-medium text-fg hover:underline">{l.reference}</Link>
                      {l.priority !== "NORMAL" && <Chip tone={PRIORITY_TONE[l.priority]}>{humanize(l.priority)}</Chip>}
                      {l.hazmat && <Chip tone="danger">Hazmat</Chip>}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge value={status} label={LOAD_STATUS_LABELS[status]} dot />
                      {l.billingStage !== "NONE" && <Chip tone={STATUS_TONE[l.billingStage] ?? "neutral"}>{BILLING_STAGE_LABELS[l.billingStage as BillingStage]}</Chip>}
                    </div>
                  </td>
                  <td className="max-w-52"><Cell primary={l.customer.name} secondary={l.broker ? `via ${l.broker.name}` : undefined} /></td>
                  <td className="max-w-64">
                    <span className="flex items-center gap-1 truncate" title={l.commodity}>
                      {l.originCity}<ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />{l.destCity}
                      {stops > 2 && <span className="num rounded-full bg-neutral-soft px-1.5 text-[10.5px] leading-4 text-fg-subtle">{stops} stops</span>}
                    </span>
                  </td>
                  <td className="num whitespace-nowrap text-fg-muted">{dateTime(l.pickupAt)}</td>
                  <td className="whitespace-nowrap">
                    <div className={cn("num", late === "late" ? "text-danger" : "text-fg-muted")}>{dateTime(l.deliveredAt ?? l.deliveryAt)}</div>
                    {late === "late" && <div className="text-[11px] text-danger">Late · due {dateTime(l.deliveryAt)}</div>}
                    {late === "eta-late" && <div className="text-[11px] text-warn">ETA {dateTime(eta)} · late</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {l.truck || l.driver ? (
                      <Cell primary={l.driver?.name ?? "—"} secondary={<span className="num">{l.truck?.unitNumber ?? "—"}{l.trailer && ` · ${l.trailer.unitNumber}`}</span>} />
                    ) : status === "PLANNED" ? (
                      canEdit ? <Link href={`/loads/${l.id}#assign`} className="font-medium text-warn hover:underline">Needs truck</Link> : <span className="font-medium text-warn">Needs truck</span>
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="num whitespace-nowrap text-right">{number(l.distanceKm)} <span className="text-fg-subtle">· {number(l.emptyKm)}</span></td>
                  {showMoney && <td className="num text-right font-medium">{money(l.rate)}</td>}
                  {showMoney && <td className="num text-right text-fg-muted">{fmtRpk(ratePerKm(l.rate, l.distanceKm, l.emptyKm))}</td>}
                  <td className="w-8 text-right"><LoadRowMenu id={l.id} reference={l.reference} status={status} canEdit={canEdit} canClaim={canClaim} /></td>
                </tr>
              );
            })}
          </Table>
          {total > PAGE_SIZE && <Pager f={f} total={total} pages={pages} shown={loads.length} />}
        </Card>
      )}
    </>
  );
}

/** "51–100 of 121 loads" with previous / next links; the URL carries the page so it survives reloads and sharing. */
function Pager({ f, total, pages, shown }: { f: LoadFilters; total: number; pages: number; shown: number }) {
  const first = (f.page - 1) * PAGE_SIZE + 1;
  const last = first + shown - 1;
  const step = (label: string, page: number, icon: ReactNode, iconAfter = false) =>
    page >= 1 && page <= pages ? (
      <LinkButton href={loadsHref(f, { page: String(page) })} variant="secondary" size="sm" rel={iconAfter ? "next" : "prev"}>
        {!iconAfter && icon}{label}{iconAfter && icon}
      </LinkButton>
    ) : (
      <span aria-disabled="true" className={cn(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")}>{!iconAfter && icon}{label}{iconAfter && icon}</span>
    );
  return (
    <nav aria-label="Loads pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[12px] text-fg-muted">
      <p>
        <span className="num text-fg">{number(first)}–{number(last)}</span> of <span className="num text-fg">{number(total)}</span> loads
      </p>
      <div className="flex items-center gap-1.5">
        <span className="num mr-1 text-fg-subtle">Page {f.page} of {pages}</span>
        {step("Previous", f.page - 1, <ChevronLeft />)}
        {step("Next", f.page + 1, <ChevronRight />, true)}
      </div>
    </nav>
  );
}
