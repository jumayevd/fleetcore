import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Card, EmptyState, LinkButton, Table } from "@/components/ui";
import { ActionButton } from "@/components/shop/action-button";
import { RepairDue, RepairStatus, RepairTags } from "@/components/shop/repair-bits";
import { driverNotTold, isActive, linesSummary } from "@/components/shop/shared";
import { markDriverInformed } from "@/app/actions/repairs";

const YEAR = 365 * 86_400_000;
const SHOWN = 25;

/**
 * Repair orders of one unit, open first (truck or trailer page, Maintenance tab): what is going on, where, how long it
 * has been off the road, who pays, and "Driver told" where a driver charge is waiting. Costs only for people who can
 * see money.
 */
export async function UnitRepairs({ unit, editable }: { unit: { type: "truck" | "trailer"; id: string }; editable: boolean }) {
  const [user, f] = await Promise.all([getCurrentUser(), getFormat()]);
  const money = can(user?.role, "money.view");
  const where = unit.type === "truck" ? { truckId: unit.id } : { trailerId: unit.id };
  const now = new Date();
  const [rows, total, open, year] = await Promise.all([
    db.workOrder.findMany({
      where, orderBy: { createdAt: "desc" }, take: 60,
      include: { vendorRef: { select: { id: true, name: true, phone: true } }, chargeDriver: { select: { name: true } }, lines: { orderBy: { position: "asc" }, select: { system: true, work: true } } },
    }),
    db.workOrder.count({ where }),
    db.workOrder.count({ where: { ...where, voidedAt: null, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } } }),
    db.workOrder.aggregate({ where: { ...where, status: "DONE", voidedAt: null, completedAt: { gte: new Date(now.getTime() - YEAR) } }, _sum: { cost: true }, _count: { _all: true } }),
  ]);
  // Open work first (in the shop, then booked), then the most recent.
  const rank = (s: string) => (s === "IN_PROGRESS" ? 0 : isActive(s) ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, SHOWN);
  const nowMs = now.getTime();
  const todayStart = f.startOfDay(now).getTime();
  const param = unit.type === "truck" ? "truck" : "trailer";
  const allHref = `/maintenance/work-orders?unit=${unit.id}&status=all`;

  return (
    <Card title="Repairs" flush icon={<Wrench />}
      actions={
        <>
          <span className="hidden text-[11px] text-fg-subtle sm:inline">
            <span className="num">{open}</span> open · <span className="num">{year._count._all}</span> done in 12 months{money && <> · <span className="num">{f.money(year._sum.cost)}</span></>}
          </span>
          {total > 0 && <Link href={allHref} className="text-[12px] font-medium text-fg-muted hover:text-fg">All repairs</Link>}
          {editable && <LinkButton href={`/maintenance/work-orders/new?${param}=${unit.id}`} variant="secondary" size="sm"><Plus />Create repair</LinkButton>}
        </>
      }>
      {sorted.length === 0 ? (
        <EmptyState icon={<Wrench />} title="No repairs yet"
          description={editable ? "Create one to book this unit into a shop, or log work that is already done." : "Repairs on this unit will be listed here."} />
      ) : (
        <Table head={["Repair", "Work", "Shop", "Status", "Due / done", ...(money ? ["Cost"] : []), ""]}>
          {sorted.map((w) => {
            const summary = linesSummary(w.lines);
            const amount = w.invoiceTotal ?? w.cost;
            return (
              <tr key={w.id} className={w.voidedAt || w.status === "CANCELLED" ? "opacity-60" : undefined}>
                <td className="whitespace-nowrap">
                  <Link href={`/maintenance/work-orders/${w.id}`} className="num font-medium text-fg hover:underline">{roLabel(w.number)}</Link>
                  <p className="num text-[11px] text-fg-subtle">{f.day(w.createdAt)}</p>
                </td>
                <td className="max-w-80">
                  <Link href={`/maintenance/work-orders/${w.id}`} className="block truncate text-fg hover:underline" title={summary || w.title}>{w.title}</Link>
                  {summary && <p className="truncate text-[11px] text-fg-subtle">{summary}</p>}
                  <RepairTags w={w} className="mt-1" />
                </td>
                <td className="max-w-44">
                  {w.vendorRef
                    ? <Link href={`/vendors/${w.vendorRef.id}`} className="block truncate text-fg-muted hover:text-fg hover:underline">{w.vendorRef.name}</Link>
                    : <span className="block truncate text-fg-muted">{w.vendor ?? <span className="text-fg-faint">No shop</span>}</span>}
                </td>
                <td><RepairStatus w={w} now={nowMs} /></td>
                <td><RepairDue w={w} f={f} now={nowMs} todayStart={todayStart} /></td>
                {money && <td className="num whitespace-nowrap">{amount && !w.voidedAt ? f.money(amount) : <span className="text-fg-faint">—</span>}</td>}
                <td className="text-right">
                  {editable && driverNotTold(w) && w.chargeDriverId && (
                    <ActionButton action={markDriverInformed.bind(null, w.id)} title={w.chargeDriver ? `Mark ${w.chargeDriver.name} as told` : undefined}>Driver told</ActionButton>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {total > SHOWN && (
        <div className="border-t border-line px-4 py-2 text-[12px]"><Link href={allHref} className="font-medium text-fg-muted hover:text-fg">All {f.number(total)} repairs</Link></div>
      )}
    </Card>
  );
}
