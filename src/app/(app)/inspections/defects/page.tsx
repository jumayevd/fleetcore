import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ClipboardCheck, Clock, ShieldAlert, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { DEFECT_SEVERITIES } from "@/lib/constants";
import { defectLabel } from "@/lib/service";
import { companyMembers, openRepairsFor } from "@/lib/pti";
import {
  DEFECT_COMPONENTS, DEFECT_STATUS_TONE, DEFECT_VIEWS, SEVERITY_RANK, SEVERITY_SHORT, SEVERITY_TONE, byUnit, componentLabel, daysBetween,
  defectStatusLabel, defectsHref, newRepairHref, one, plural, severityLabel, type DefectView,
} from "@/lib/pti-shared";
import { Card, Chip, FilterPills, InfoTip, LinkButton, PageHeader, Stat, Table, cn } from "@/components/ui";
import { ListFilters } from "@/components/inspections/list-filters";
import { DefectActions, OwnerSelect, RepairCell } from "@/components/inspections/defect-controls";
import { ReportDefect } from "@/components/inspections/report-defect";
import { ScrollTo } from "@/components/inspections/scroll-to";

export const metadata = { title: "Defects" };

const PAGE = 300;
const VIEW_LABELS: Record<DefectView, string> = { unresolved: "Unresolved", OPEN: "Open", REPAIRED: "To confirm", CLOSED: "Closed", all: "All" };
const VIEW_WHERE: Record<DefectView, Prisma.DefectWhereInput> = {
  unresolved: { status: { in: ["OPEN", "REPAIRED"] } }, OPEN: { status: "OPEN" }, REPAIRED: { status: "REPAIRED" }, CLOSED: { status: "CLOSED" }, all: {},
};

const include = {
  truck: { select: { id: true, unitNumber: true, driver: { select: { name: true } } } },
  trailer: { select: { id: true, unitNumber: true } },
  owner: { select: { id: true, name: true } },
  closedBy: { select: { name: true } },
  workOrder: { select: { id: true, number: true, status: true } },
  walkAround: { select: { weekStart: true } },
} satisfies Prisma.DefectInclude;
type Row = Prisma.DefectGetPayload<{ include: typeof include }>;

export default async function DefectsPage({ searchParams }: PageProps<"/inspections/defects">) {
  const me = await requireUser("fleet.view");
  const editable = can(me.role, "fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;
  const now = new Date();

  const statusParam = one(sp.status);
  const view: DefectView = (DEFECT_VIEWS as readonly string[]).includes(statusParam ?? "") ? (statusParam as DefectView) : "unresolved";
  const severity = one(sp.severity);
  const kind = one(sp.kind);
  const unit = one(sp.unit);
  const owner = one(sp.owner);
  const overdue = one(sp.overdue) === "1";
  const holding = one(sp.holding) === "1";
  const q = one(sp.q);
  const highlight = one(sp.defect);
  /** ?view=unassigned (from Today): walk-around issues still open with no owner and no repair. */
  const unassigned = one(sp.view) === "unassigned";

  const and: Prisma.DefectWhereInput[] = [];
  if (unassigned) and.push({ status: "OPEN", ownerId: null, workOrderId: null, walkAroundId: { not: null } });
  if (severity && (DEFECT_SEVERITIES as readonly string[]).includes(severity)) and.push({ severity });
  if (kind === "truck") and.push({ truckId: { not: null } });
  if (kind === "trailer") and.push({ trailerId: { not: null } });
  if (unit) and.push({ OR: [{ truckId: unit }, { trailerId: unit }] });
  if (owner === "me") and.push({ ownerId: me.id });
  else if (owner === "none") and.push({ ownerId: null });
  else if (owner) and.push({ ownerId: owner });
  if (overdue) and.push({ status: "OPEN", dueAt: { lt: now } });
  if (holding) and.push({ holdsUnit: true, status: { not: "CLOSED" } });
  if (q) {
    const n = /^(?:def-?)?0*(\d+)$/i.exec(q);
    const comps = DEFECT_COMPONENTS.filter((c) => componentLabel(c).toLowerCase().includes(q.toLowerCase()));
    and.push({
      OR: [
        ...(n ? [{ number: Number(n[1]) }] : []),
        { description: { contains: q, mode: "insensitive" } },
        ...(comps.length ? [{ component: { in: [...comps] } }] : []),
        { truck: { unitNumber: { contains: q, mode: "insensitive" } } },
        { trailer: { unitNumber: { contains: q, mode: "insensitive" } } },
        { truck: { driver: { name: { contains: q, mode: "insensitive" } } } },
        { closeNote: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const base: Prisma.DefectWhereInput = and.length ? { AND: and } : {};
  const where: Prisma.DefectWhereInput = { AND: [...and, VIEW_WHERE[view]] };

  const [fetched, byStatus, holdingCount, overdueCount, toConfirm, unowned, trucks, trailers, members] = await Promise.all([
    db.defect.findMany({ where, include, take: PAGE, orderBy: view === "CLOSED" ? { closedAt: "desc" } : { foundAt: "asc" } }),
    db.defect.groupBy({ by: ["status"], where: base, _count: true }),
    db.defect.count({ where: { holdsUnit: true, status: { not: "CLOSED" } } }),
    db.defect.count({ where: { status: "OPEN", dueAt: { lt: now } } }),
    db.defect.count({ where: { status: "REPAIRED" } }),
    db.defect.count({ where: { status: { in: ["OPEN", "REPAIRED"] }, ownerId: null } }),
    db.truck.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true, unitNumber: true, make: true, model: true } }),
    db.trailer.findMany({ select: { id: true, unitNumber: true, type: true } }),
    companyMembers(me.company.id),
  ]);
  let rows: Row[] = [...fetched];
  if (view !== "CLOSED") {
    const group = (d: Row) => (d.status === "CLOSED" ? 1 : 0);
    rows.sort((a, b) => group(a) - group(b) || Number(b.holdsUnit) - Number(a.holdsUnit)
      || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.foundAt.getTime() - b.foundAt.getTime());
  }
  // A defect someone linked to is shown even when the filters would hide it.
  let pinned = false;
  if (highlight && !rows.some((d) => d.id === highlight)) {
    const d = await db.defect.findUnique({ where: { id: highlight }, include });
    if (d) { rows = [d, ...rows]; pinned = true; }
  }
  const repairs = editable ? await openRepairsFor(rows.map((d) => ({ truckId: d.truckId, trailerId: d.trailerId }))) : new Map<string, { id: string; label: string }[]>();

  const countOf = (s: string) => byStatus.find((c) => c.status === s)?._count ?? 0;
  const viewCount: Record<DefectView, number> = {
    unresolved: countOf("OPEN") + countOf("REPAIRED"), OPEN: countOf("OPEN"), REPAIRED: countOf("REPAIRED"), CLOSED: countOf("CLOSED"),
    all: countOf("OPEN") + countOf("REPAIRED") + countOf("CLOSED"),
  };
  const keepParams = { severity, kind, unit, owner, q, overdue: overdue ? "1" : undefined, holding: holding ? "1" : undefined };
  const viewParam = unassigned ? "unassigned" : undefined;
  const truckOpts = [...trucks].sort((a, b) => byUnit(a.unitNumber, b.unitNumber)).map((t) => ({ id: t.id, label: `${t.unitNumber} · ${t.make} ${t.model}` }));
  const trailerOpts = [...trailers].sort((a, b) => byUnit(a.unitNumber, b.unitNumber)).map((t) => ({ id: t.id, label: t.unitNumber }));
  const presetTruck = one(sp.truck);
  const presetTrailer = one(sp.trailer);
  const preset = presetTruck ? { type: "truck" as const, id: presetTruck } : presetTrailer ? { type: "trailer" as const, id: presetTrailer } : undefined;
  const filtered = and.length > 0;
  const closeNewHref = defectsHref({ status: view, ...keepParams, view: viewParam });

  return (
    <>
      <PageHeader
        title="Defects"
        subtitle="Everything found wrong on a unit, until it is fixed and someone confirms it"
        actions={
          <>
            <LinkButton href="/inspections" variant="secondary"><ClipboardCheck />Pre-trip board</LinkButton>
            {editable && <ReportDefect trucks={truckOpts} trailers={trailerOpts} members={members} preset={preset} startOpen={one(sp.new) === "1"} closeHref={closeNewHref} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={defectsHref({ holding: "1" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Holding a unit" value={holdingCount} tone={holdingCount ? "danger" : "ok"} icon={<ShieldAlert />}
            hint={holdingCount ? "Out of service until someone confirms the repair" : "No unit is held by a defect"} />
        </Link>
        <Link href={defectsHref({ status: "OPEN", overdue: "1" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Overdue" value={overdueCount} tone={overdueCount ? "warn" : "ok"} icon={<Clock />} hint={overdueCount ? "Past the date they should be fixed by" : "Nothing past its due date"} />
        </Link>
        <Link href={defectsHref({ status: "REPAIRED" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Repaired, to confirm" value={toConfirm} tone={toConfirm ? "info" : "neutral"} icon={<ClipboardCheck />} hint="The shop says fixed; someone checks and closes it" />
        </Link>
        <Link href={defectsHref({ owner: "none" })} className="block rounded-lg hover:shadow-lift">
          <Stat label="Nobody owns" value={unowned} tone={unowned ? "warn" : "ok"} icon={<TriangleAlert />} hint={unowned ? "Give each one an owner so it gets chased" : "Every open defect has an owner"} />
        </Link>
      </div>

      <Card className="mt-4" flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterPills active={view} items={DEFECT_VIEWS.map((v) => ({ key: v, label: VIEW_LABELS[v], count: viewCount[v], href: defectsHref({ status: v, ...keepParams }) }))} />
            <InfoTip>Unresolved is open plus repaired-but-not-confirmed. Defects that hold a unit come first, then by severity, oldest first.</InfoTip>
          </div>
          <ListFilters keep={["status"]}
            search={{ placeholder: "Search defects…", title: "Number (DEF-0012), component, description, unit or driver" }}
            toggles={[
              { name: "holding", label: "Holding a unit", title: "Defects that keep their unit out of service", icon: <ShieldAlert /> },
              { name: "overdue", label: "Overdue", title: "Open and past the date they should be fixed by", icon: <Clock /> },
            ]}
            selects={[
              { name: "severity", label: "Severity", options: DEFECT_SEVERITIES.map((s) => ({ value: s, label: severityLabel(s) })) },
              { name: "kind", label: "Unit type", allLabel: "Trucks and trailers", options: [{ value: "truck", label: "Trucks" }, { value: "trailer", label: "Trailers" }] },
              { name: "unit", label: "Unit", options: [...truckOpts.map((t) => ({ value: t.id, label: t.label })), ...trailerOpts.map((t) => ({ value: t.id, label: `${t.label} · trailer` }))] },
              { name: "owner", label: "Owner", allLabel: "Anyone", options: [{ value: "me", label: "Me" }, { value: "none", label: "Nobody yet" }, ...members.filter((m) => m.id !== me.id).map((m) => ({ value: m.id, label: m.name }))] },
            ]} />
        </div>
        {unassigned && (
          <p className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warn-soft px-4 py-2 text-[12px] text-warn">
            <span>Walk-around issues still open with no owner and no repair. Give each one an owner or open a repair.</span>
            <Link href={defectsHref({ status: view, ...keepParams })} className="font-medium underline-offset-2 hover:underline">Show every defect</Link>
          </p>
        )}
        {pinned && <p className="border-b border-line bg-accent-soft px-4 py-2 text-[12px] text-accent-text">The defect you followed a link to is shown first, even though these filters would hide it.</p>}
        <Table head={["Defect", "Unit", "What is wrong", "Severity", "Status", "Owner", "Repair", ""]} empty={rows.length === 0}
          emptyTitle={filtered || view !== "unresolved" ? "Nothing matches" : "No open defects"}
          emptyDescription={filtered || view !== "unresolved" ? "Clear a filter or pick another view." : editable ? "Defects come from walk-around reviews on the pre-trip board, or use Report a defect." : "Defects from walk-around reviews will show here."}>
          {rows.map((d) => {
            const unitHref = d.truck ? `/fleet/${d.truck.id}` : d.trailer ? `/fleet/trailers/${d.trailer.id}` : null;
            const isOverdue = d.status === "OPEN" && d.dueAt != null && d.dueAt.getTime() < now.getTime();
            const lit = d.id === highlight;
            return (
              <tr key={d.id} id={`defect-${d.id}`} className={cn("align-top", lit && "bg-accent-soft/60")}>
                <td className="whitespace-nowrap">
                  <span className="num font-medium text-fg">{defectLabel(d.number)}</span>
                  <div className="text-[11px] text-fg-subtle" title={f.dateTime(d.foundAt)}>
                    {f.day(d.foundAt)} · {d.walkAround ? <Link href={`/inspections?week=${d.walkAround.weekStart.toISOString().slice(0, 10)}`} className="hover:underline">walk-around</Link> : "reported"}
                  </div>
                </td>
                <td className="whitespace-nowrap">
                  {unitHref ? <Link href={unitHref} className="num unit-no font-medium text-fg hover:underline">{d.truck?.unitNumber ?? d.trailer?.unitNumber}</Link> : "—"}
                  <div className="max-w-40 truncate text-[11px] text-fg-subtle">{d.truck ? d.truck.driver?.name ?? "No driver" : "Trailer"}</div>
                </td>
                <td className="max-w-96">
                  <div className="font-medium text-fg">{componentLabel(d.component)}</div>
                  <div className="line-clamp-2 text-[12px] text-fg-muted" title={d.description}>{d.description}</div>
                </td>
                <td className="whitespace-nowrap">
                  <Chip tone={SEVERITY_TONE[d.severity] ?? "neutral"} title={severityLabel(d.severity)}>{SEVERITY_SHORT[d.severity] ?? d.severity}</Chip>
                  {d.holdsUnit && d.status !== "CLOSED" && <div className="mt-1"><Chip tone="danger">Holding the unit</Chip></div>}
                </td>
                <td className="whitespace-nowrap">
                  <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium",
                    isOverdue ? "text-danger" : d.status === "REPAIRED" ? "text-info" : d.status === "OPEN" ? "text-warn" : "text-fg-muted")}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", isOverdue ? "bg-danger" : DEFECT_STATUS_TONE[d.status] === "info" ? "bg-info" : DEFECT_STATUS_TONE[d.status] === "warn" ? "bg-warn" : "bg-fg-faint")} />
                    {d.status === "OPEN" ? (isOverdue ? `Overdue ${plural(daysBetween(d.dueAt!, now), "day")}` : `Open ${plural(daysBetween(d.foundAt, now), "day")}`) : defectStatusLabel(d.status)}
                  </span>
                  <div className="text-[11px] text-fg-subtle" title={d.closeNote ?? undefined}>
                    {d.status === "OPEN" ? (d.dueAt ? `Fix by ${f.day(d.dueAt)}` : "") : d.status === "REPAIRED" ? `Since ${f.day(d.repairedAt)}` : `${f.day(d.closedAt)}${d.closedBy ? ` by ${d.closedBy.name}` : ""}`}
                  </div>
                  {d.status === "CLOSED" && d.closeNote && <div className="max-w-56 truncate text-[11px] text-fg-subtle" title={d.closeNote}>{d.closeNote}</div>}
                </td>
                <td className="whitespace-nowrap">
                  {editable && d.status !== "CLOSED"
                    ? <OwnerSelect id={d.id} ownerId={d.ownerId} members={members} />
                    : <span className={d.owner ? "text-fg-muted" : "text-fg-faint"}>{d.owner?.name ?? "—"}</span>}
                </td>
                <td className="whitespace-nowrap">
                  <RepairCell id={d.id} workOrder={d.workOrder} editable={editable && d.status !== "CLOSED"}
                    openOrders={repairs.get(d.truckId ?? d.trailerId ?? "") ?? []} newHref={newRepairHref(d)} />
                </td>
                <td className="whitespace-nowrap text-right">
                  {editable && <DefectActions id={d.id} number={d.number} status={d.status} severity={d.severity} holdsUnit={d.holdsUnit} compact />}
                </td>
              </tr>
            );
          })}
        </Table>
        {fetched.length >= PAGE && <p className="border-t border-line bg-info-soft px-4 py-2 text-[12px] text-info">Showing the first {PAGE}. Narrow the filters to see the rest.</p>}
      </Card>
      {highlight && <ScrollTo id={`defect-${highlight}`} />}
    </>
  );
}
