import Link from "next/link";
import { Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { INSPECTION_LEVEL_LABELS } from "@/lib/constants";
import {
  DAY_MS, ROADSIDE_RESULT_TONE, ROADSIDE_STATUS_TONE, VIOLATION_UNIT_LABELS, levelShort, plural, roadsideHref, roadsideResultLabel, roadsideStatusLabel,
} from "@/lib/pti-shared";
import { Badge, Card, Chip } from "@/components/ui";

const MAX = 25;

/** Roadside inspections and violations of one unit, newest first (owned by the inspections module). */
export async function UnitSafetyHistory({ unit }: { unit: { type: "truck" | "trailer"; id: string } }) {
  const [me, f] = await Promise.all([getCurrentUser(), getFormat()]);
  const where = unit.type === "truck" ? { truckId: unit.id } : { trailerId: unit.id };
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);
  const [rows, total] = await Promise.all([
    db.roadsideInspection.findMany({
      where, orderBy: { inspectedAt: "desc" }, take: MAX,
      include: { driver: { select: { id: true, name: true } }, violations: { orderBy: { id: "asc" } } },
    }),
    db.roadsideInspection.count({ where }),
  ]);
  const editable = can(me?.role, "fleet.edit");
  const lastYear = rows.filter((r) => r.inspectedAt >= yearAgo);
  const oos = lastYear.filter((r) => r.result === "OOS").length;

  return (
    <Card flush title={
      <span className="flex items-center gap-2">
        Roadside inspections
        {total > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{total}</span>}
      </span>
    } actions={
      <span className="flex items-center gap-3">
        {editable && <Link href={`/inspections/roadside/new?${unit.type}=${unit.id}`} className="text-[12px] font-medium text-accent-text hover:underline">Log one</Link>}
        {total > 0 && <Link href={roadsideHref({ unit: unit.id })} className="text-[12px] text-fg-muted hover:text-fg">All</Link>}
      </span>
    }>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 pt-1 text-[13px] text-fg-muted">No roadside inspections on record for this {unit.type}.{editable ? " Log one from the report the driver brings back, clean ones too." : ""}</p>
      ) : (
        <>
          <p className="px-4 pb-2 text-[12px] text-fg-subtle">
            {plural(lastYear.length, "inspection")} in the last 12 months{oos ? <> · <span className="font-medium text-danger">{oos} out of service</span></> : ""}
          </p>
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-[13px]">
                    <Link href={`/inspections/roadside/${r.id}`} className="num font-medium text-fg hover:underline">{f.date(r.inspectedAt)}</Link>
                    <span className="text-fg-muted" title={INSPECTION_LEVEL_LABELS[r.level]}> · {levelShort(r.level)}</span>
                    {(r.location || r.state) && <span className="text-fg-subtle"> · {[r.location, r.state].filter(Boolean).join(", ")}</span>}
                    {r.driver && <span className="text-fg-subtle"> · {r.driver.name}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Badge value={r.result} label={roadsideResultLabel(r.result)} tone={ROADSIDE_RESULT_TONE[r.result]} dot />
                    {r.result !== "CLEAN" && <Badge value={r.status} label={roadsideStatusLabel(r.status)} tone={ROADSIDE_STATUS_TONE[r.status]} />}
                  </span>
                </div>
                {r.violations.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {r.violations.map((v) => (
                      <li key={v.id} className="flex items-baseline gap-1.5 text-[12px]">
                        {v.code && <span className="num shrink-0 text-fg-muted">{v.code}</span>}
                        <span className="min-w-0 truncate text-fg" title={v.description}>{v.description}</span>
                        <span className="shrink-0 text-[11px] text-fg-subtle">{VIOLATION_UNIT_LABELS[v.unit] ?? v.unit}</span>
                        {v.oos && <Chip tone="danger" className="shrink-0">OOS</Chip>}
                        {v.correctedAt && <Check aria-label="Corrected" className="h-3.5 w-3.5 shrink-0 text-ok" />}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {total > MAX && <p className="border-t border-line px-4 py-2 text-[12px]"><Link href={roadsideHref({ unit: unit.id })} className="text-fg-muted hover:text-fg">See all {total}</Link></p>}
        </>
      )}
    </Card>
  );
}
