import Link from "next/link";
import { History } from "lucide-react";
import { db } from "@/lib/db";
import { PAYER_LABELS, REPAIR_TYPE_LABELS } from "@/lib/constants";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Card, Chip, EmptyState } from "@/components/ui";

/** Completed repair orders of a truck or trailer as a timeline, newest first (History tab / trailer page). */
export async function CompletedRepairs({ unit, showMoney, limit = 40 }: { unit: { type: "truck" | "trailer"; id: string }; showMoney: boolean; limit?: number }) {
  const f = await getFormat();
  const where = { status: "DONE", voidedAt: null, ...(unit.type === "truck" ? { truckId: unit.id } : { trailerId: unit.id }) };
  const [rows, total] = await Promise.all([
    db.workOrder.findMany({
      where, orderBy: [{ completedAt: "desc" }, { number: "desc" }], take: limit,
      select: {
        id: true, number: true, title: true, repairType: true, completedAt: true, outAt: true, odometerKm: true, odometerOutKm: true,
        cost: true, payer: true, vendor: true, vendorRef: { select: { name: true } }, _count: { select: { lines: true } },
      },
    }),
    db.workOrder.count({ where }),
  ]);
  const all = `/maintenance/work-orders?unit=${unit.id}&status=DONE`;

  return (
    <Card title="Completed repairs" icon={<History />} flush
      actions={total > rows.length
        ? <Link href={all} className="text-[11px] font-medium text-fg-muted hover:text-fg">All {total} →</Link>
        : total > 0 && <span className="num text-[11px] text-fg-subtle">{total}</span>}>
      {rows.length === 0 ? (
        <EmptyState title="No completed repairs yet" description="Every repair order closed out on this unit lands here, so its history is one scroll away." />
      ) : (
        <ol className="px-4 pb-3">
          {rows.map((w, i) => {
            const vendor = w.vendorRef?.name ?? w.vendor;
            const odometer = w.odometerOutKm ?? w.odometerKm;
            return (
              <li key={w.id} className="relative flex gap-3 pb-3 last:pb-0">
                {/* the timeline rail */}
                <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-ok" />
                  {i < rows.length - 1 && <span className="absolute top-4 bottom-[-6px] w-px bg-line" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="min-w-0 truncate text-[13px] text-fg">
                      <Link href={`/maintenance/work-orders/${w.id}`} className="num font-medium hover:underline">{roLabel(w.number)}</Link>
                      <span className="text-fg-muted"> · </span>{w.title}
                    </p>
                    <span className="num shrink-0 text-[12px] text-fg-muted">{f.date(w.completedAt ?? w.outAt)}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
                    <span>{REPAIR_TYPE_LABELS[w.repairType] ?? w.repairType}</span>
                    {vendor && <span>· {vendor}</span>}
                    {odometer != null && <span className="num">· {f.dist(odometer)}</span>}
                    {w._count.lines > 0 && <span>· {w._count.lines} line{w._count.lines === 1 ? "" : "s"}</span>}
                    {showMoney && w.cost > 0 && <span className="num text-fg-muted">· {f.money(w.cost)}</span>}
                    {w.payer !== "COMPANY" && <Chip tone={w.payer === "DRIVER" ? "warn" : "info"}>{PAYER_LABELS[w.payer] ?? w.payer}</Chip>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
