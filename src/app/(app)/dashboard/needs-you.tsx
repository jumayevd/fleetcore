import Link from "next/link";
import { FileBadge, Truck, Users, Wrench, type LucideIcon } from "lucide-react";
import type { Alert } from "@/lib/alerts";
import { Disclosure, IconTile, StatusDot, cardClass, cn, type Hue } from "@/components/ui";
import type { AlertGroup, AlertKind } from "./lib";

/** Items listed inside an open category; the rest are one click away on /dashboard/alerts. */
const SHOW = 5;

export const KIND_ICON: Record<AlertKind, LucideIcon> = { compliance: FileBadge, maintenance: Wrench, drivers: Users, fleet: Truck };
export const KIND_HUE: Record<AlertKind, Hue> = { compliance: "hue-1", maintenance: "hue-4", drivers: "hue-5", fleet: "hue-3" };

/**
 * What needs a decision, sorted into categories (worst first). Each category opens on click and only one is
 * open at a time, so the card stays short; the worst one starts open. Alerts are already filtered to this role.
 */
export function NeedsAttention({ alerts, groups, className }: { alerts: Alert[]; groups: AlertGroup[]; className?: string }) {
  const critical = alerts.filter((a) => a.level === "critical").length;
  return (
    <section aria-labelledby="needs-attention" className={cn(cardClass, "flex min-w-0 flex-col", className)}>
      <header className="flex min-h-12 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h2 id="needs-attention" className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          Needs attention
          {alerts.length > 0 && <span className="num rounded-full bg-neutral-soft px-1.5 text-[11px] font-medium leading-5 text-fg-muted">{alerts.length}</span>}
          {critical > 0 && <span className="num rounded-full bg-danger-soft px-1.5 text-[11px] font-medium leading-5 text-danger">{critical} critical</span>}
        </h2>
        {alerts.length > 0 && <Link href="/dashboard/alerts" className="text-[12px] font-medium text-fg-muted hover:text-fg">View all →</Link>}
      </header>

      {alerts.length === 0 ? (
        <div className="flex flex-1 items-center gap-3 px-4 py-8">
          <IconTile tone="ok"><StatusDot tone="ok" /></IconTile>
          <div>
            <p className="text-[13px] font-medium text-fg">All clear</p>
            <p className="text-[12px] text-fg-muted">Nothing needs a decision right now.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-line border-t border-line">
          {groups.map((g, gi) => {
            const Icon = KIND_ICON[g.kind];
            const more = g.items.length - SHOW;
            return (
              <Disclosure key={g.kind} name="attention" open={gi === 0} title={g.label} icon={<Icon />} tone={KIND_HUE[g.kind]}
                count={g.items.length}
                meta={g.critical > 0 ? <span className="num rounded-full bg-danger-soft px-1.5 text-[11px] font-medium leading-5 text-danger">{g.critical} critical</span> : null}>
                <ul className="pb-1.5">
                  {g.items.slice(0, SHOW).map((a, i) => (
                    <li key={`${a.href}-${i}`}>
                      <Link href={a.href} className="flex items-center gap-2.5 py-1.5 pl-[52px] pr-4 transition-colors hover:bg-raised">
                        <StatusDot tone={a.level === "critical" ? "danger" : "warn"} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={a.detail}>{a.title}</span>
                        <span className="hidden max-w-[45%] shrink-0 truncate text-[12px] text-fg-subtle sm:block">{a.detail}</span>
                      </Link>
                    </li>
                  ))}
                  {more > 0 && (
                    <li>
                      <Link href={`/dashboard/alerts?kind=${g.kind}`} className="block py-1.5 pl-[52px] pr-4 text-[12px] font-medium text-fg-muted hover:text-fg">
                        All {g.items.length} in {g.label.toLowerCase()} →
                      </Link>
                    </li>
                  )}
                </ul>
              </Disclosure>
            );
          })}
        </div>
      )}
    </section>
  );
}
