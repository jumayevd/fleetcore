import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFormat } from "@/lib/format-server";
import { defectLabel } from "@/lib/service";
import { openRepairsFor } from "@/lib/pti";
import {
  SEVERITY_SHORT, SEVERITY_TONE, componentLabel, daysBetween, defectsHref, newRepairHref, plural, severityLabel,
} from "@/lib/pti-shared";
import { Card, Chip, Disclosure, StatusDot, cn } from "@/components/ui";
import { DefectActions, RepairCell } from "@/components/inspections/defect-controls";
import { ReportDefect } from "@/components/inspections/report-defect";

/**
 * Open and recently closed defects of one unit, with fix / confirm actions (owned by the inspections module).
 * A defect that holds the unit is listed first and says so.
 */
export async function UnitDefects({ unit, editable }: { unit: { type: "truck" | "trailer"; id: string }; editable: boolean }) {
  const f = await getFormat();
  const me = await getCurrentUser();
  const noteOptional = can(me?.role, "defects.closeWithoutNote");
  const canDelete = can(me?.role, "defects.delete");
  const now = new Date();
  const where = unit.type === "truck" ? { truckId: unit.id } : { trailerId: unit.id };
  const [open, closed, closedCount, self] = await Promise.all([
    db.defect.findMany({
      where: { ...where, status: { in: ["OPEN", "REPAIRED"] } },
      orderBy: [{ holdsUnit: "desc" }, { foundAt: "asc" }],
      include: { owner: { select: { name: true } }, workOrder: { select: { id: true, number: true, status: true } } },
    }),
    db.defect.findMany({ where: { ...where, status: "CLOSED" }, orderBy: { closedAt: "desc" }, take: 5, include: { closedBy: { select: { name: true } } } }),
    db.defect.count({ where: { ...where, status: "CLOSED" } }),
    unit.type === "truck"
      ? db.truck.findUnique({ where: { id: unit.id }, select: { unitNumber: true } })
      : db.trailer.findUnique({ where: { id: unit.id }, select: { unitNumber: true } }),
  ]);
  if (!self) return null;
  const repairs = editable && open.length ? await openRepairsFor([unit.type === "truck" ? { truckId: unit.id } : { trailerId: unit.id }]) : new Map<string, { id: string; label: string }[]>();
  const holding = open.filter((d) => d.holdsUnit).length;

  return (
    <Card title={
      <span className="flex items-center gap-2">
        Defects
        {open.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{open.length}</span>}
        {holding > 0 && <Chip tone="danger">Out of service until confirmed</Chip>}
      </span>
    } flush actions={
      <span className="flex items-center gap-2">
        {editable && <ReportDefect fixed={{ type: unit.type, id: unit.id, label: self.unitNumber }} variant="secondary" label="Report" />}
        <Link href={defectsHref({ unit: unit.id, status: "all" })} className="text-[12px] text-fg-muted hover:text-fg">All</Link>
      </span>
    }>
      {open.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-3 pt-1 text-[13px] text-fg-muted">
          <StatusDot tone="ok" />No open defects. Walk-around reviews and reports add them here.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {open.map((d) => {
            const overdue = d.status === "OPEN" && d.dueAt != null && d.dueAt.getTime() < now.getTime();
            return (
              <li key={d.id} className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-2.5", d.holdsUnit && "bg-danger-soft/40")}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-fg">
                    <Link href={defectsHref({ defect: d.id })} className="num font-medium hover:underline">{defectLabel(d.number)}</Link>
                    <span className="text-fg-muted"> · {componentLabel(d.component)}</span> — {d.description}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                    <Chip tone={SEVERITY_TONE[d.severity] ?? "neutral"} title={severityLabel(d.severity)}>{SEVERITY_SHORT[d.severity] ?? d.severity}</Chip>
                    {d.holdsUnit && <Chip tone="danger">Holding the {unit.type}</Chip>}
                    {d.status === "REPAIRED"
                      ? <span className="text-info">repaired {f.day(d.repairedAt)} · not yet confirmed</span>
                      : <span className={overdue ? "font-medium text-danger" : undefined}>open {plural(daysBetween(d.foundAt, now), "day")}{d.dueAt ? ` · fix by ${f.day(d.dueAt)}` : ""}{overdue ? " · overdue" : ""}</span>}
                    {d.owner && <span>· {d.owner.name}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <RepairCell id={d.id} workOrder={d.workOrder} editable={editable} openOrders={repairs.get(unit.id) ?? []} newHref={newRepairHref(d)} />
                  {editable && <DefectActions id={d.id} number={d.number} status={d.status} severity={d.severity} holdsUnit={d.holdsUnit} hasOwner={Boolean(d.ownerId)} noteOptional={noteOptional} canDelete={canDelete} compact />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {closed.length > 0 && (
        <Disclosure className="border-t border-line" title="Recently closed" count={closedCount}>
          <ul className="divide-y divide-line border-t border-line">
            {closed.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-2 text-[12.5px]">
                <span className="min-w-0">
                  <Link href={defectsHref({ defect: d.id })} className="num font-medium text-fg hover:underline">{defectLabel(d.number)}</Link>
                  <span className="text-fg-muted"> · {componentLabel(d.component)} — {d.description}</span>
                  {d.closeNote && <span className="block truncate text-[11px] text-fg-subtle" title={d.closeNote}>{d.closeNote}</span>}
                </span>
                <span className="shrink-0 text-right text-[11px] text-fg-subtle">
                  {f.day(d.closedAt)}{d.closedBy ? ` · ${d.closedBy.name}` : ""}
                  {editable && <span className="mt-0.5 block"><DefectActions id={d.id} number={d.number} status={d.status} severity={d.severity} holdsUnit={d.holdsUnit} hasOwner={Boolean(d.ownerId)} noteOptional={noteOptional} canDelete={canDelete} compact /></span>}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Card>
  );
}
