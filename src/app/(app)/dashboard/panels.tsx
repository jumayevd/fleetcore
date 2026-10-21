import Link from "next/link";
import type { ReactNode } from "react";
import { isSameDay, addDays, format } from "date-fns";
import {
  ArrowRightLeft, ArrowUpRight, CalendarClock, FileText, FileWarning, Pencil, Phone, PackagePlus, Receipt, StickyNote, TriangleAlert, UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Chip, EmptyState, IconTile, LinkButton, Progress, StatusDot, buttonClass, cardClass, cn, type Hue, type Tone } from "@/components/ui";
import { ago, km, money, money2 } from "@/lib/format";
import type { weeklyProduction } from "@/lib/stats";
import type { billingQueue, RecentEvent, UpcomingPickup } from "./queries";
import { plural, type FleetLegend } from "./lib";

type Weekly = Awaited<ReturnType<typeof weeklyProduction>>;
type Billing = Awaited<ReturnType<typeof billingQueue>>;

/** Quiet "see more" link for card headers. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{children} →</Link>;
}

const SUB_TONE = { danger: "text-danger", warn: "text-warn", ok: "text-ok" } as const;
type SubTone = keyof typeof SUB_TONE;

/** Colours just the part of a line that needs a look ("1 on hold"), not the whole line. */
export function Flag({ tone, children }: { tone?: SubTone; children: ReactNode }) {
  return <span className={tone ? cn("font-medium", SUB_TONE[tone]) : undefined}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Key numbers                                                         */
/* ------------------------------------------------------------------ */

export type Kpi = {
  label: string; value: ReactNode; href?: string; icon?: LucideIcon; tone?: Tone | Hue;
  /** Context line. Shown under the number only when `alert` is set; otherwise it is the tile's hover tip. */
  sub?: ReactNode; alert?: boolean;
  /** Small coloured change chip next to the number ("+12%"). */
  delta?: { text: string; tone?: SubTone };
};

/** The day in six numbers: one tile each, a coloured icon per number, words only where something needs a look. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => {
        const Icon = k.icon;
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              {Icon && <IconTile tone={k.tone ?? "accent"}><Icon aria-hidden /></IconTile>}
              {k.href && <ArrowUpRight aria-hidden className="h-4 w-4 text-fg-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100" />}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className="num truncate text-[26px] font-semibold leading-none tracking-[-0.025em] text-fg">{k.value}</p>
              {k.delta && <span className={cn("num rounded-full px-1.5 text-[11px] font-medium leading-5", DELTA_TONE[k.delta.tone ?? "ok"])}>{k.delta.text}</span>}
            </div>
            <p className="mt-1.5 truncate text-[12px] font-medium text-fg-muted">{k.label}</p>
            {k.sub && (k.alert
              ? <p className="mt-0.5 truncate text-[12px]">{k.sub}</p>
              : (
                <span role="tooltip" className="pointer-events-none absolute left-3 top-full z-30 mt-1 w-max max-w-[calc(100%-1.5rem)] rounded-md bg-fg px-2 py-1 text-[11px] leading-4 text-surface opacity-0 shadow-float transition-opacity duration-150 group-hover:opacity-100 [&_*]:!text-surface">
                  {k.sub}
                </span>
              ))}
          </>
        );
        const tile = cn("group relative block min-w-0 px-4 py-3.5", cardClass);
        return k.href ? (
          <Link key={k.label} href={k.href}
            className={cn(tile, "transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40")}>
            {body}
          </Link>
        ) : (
          <div key={k.label} className={tile}>{body}</div>
        );
      })}
    </section>
  );
}

const DELTA_TONE: Record<SubTone, string> = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger" };

/* ------------------------------------------------------------------ */
/* Metric list (label · value · note)                                  */
/* ------------------------------------------------------------------ */

export type Metric = { label: string; value: ReactNode; note?: ReactNode; noteTone?: SubTone; href?: string };

export function MetricList({ items, className }: { items: Metric[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((m) => {
        const row = (
          <>
            <dt className="min-w-0 truncate text-[13px] text-fg-muted">{m.label}</dt>
            <dd className="flex items-baseline gap-2 whitespace-nowrap">
              {m.note && <span className={cn("num text-[12px]", m.noteTone ? SUB_TONE[m.noteTone] : "text-fg-subtle")}>{m.note}</span>}
              <span className="num text-[14px] font-semibold text-fg">{m.value}</span>
            </dd>
          </>
        );
        return m.href ? (
          <Link key={m.label} href={m.href} className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-raised">{row}</Link>
        ) : (
          <div key={m.label} className="flex items-center justify-between gap-3 py-2">{row}</div>
        );
      })}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Billing queue                                                       */
/* ------------------------------------------------------------------ */

function QueueRow({ href, label, hint, count, sum, tone, icon: Icon }: {
  href: string; label: string; hint: string; count: number; sum?: number; tone: Tone; icon: LucideIcon;
}) {
  return (
    <Link href={href} title={hint} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised">
      <IconTile tone={count ? tone : "neutral"}><Icon aria-hidden /></IconTile>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{label}</span>
      {sum !== undefined && count > 0 && <span className="num text-[12px] text-fg-subtle">{money(sum)}</span>}
      <span className={cn("num min-w-6 text-right text-[16px] font-semibold", count ? (tone === "danger" ? "text-danger" : "text-fg") : "text-fg-faint")}>{count}</span>
    </Link>
  );
}

export function BillingQueue({ queue, overdue, showMoney }: { queue: Billing; overdue: { count: number; amount: number } | null; showMoney: boolean }) {
  // Finance roles work the queue on /finance (its default tab); everyone else gets the loads list filtered by billing stage.
  return (
    <div className="divide-y divide-line">
      <QueueRow href={showMoney ? "/finance" : "/loads?billing=MISSING_DOCS"} label="Missing documents" hint="Delivered, waiting on RC or POD" icon={FileWarning} tone="warn"
        count={queue.missingDocs.count} sum={showMoney ? queue.missingDocs.sum : undefined} />
      <QueueRow href={showMoney ? "/finance" : "/loads?billing=READY_TO_INVOICE"} label="Ready to invoice" hint="Paperwork complete, not billed yet" icon={Receipt} tone="info"
        count={queue.ready.count} sum={showMoney ? queue.ready.sum : undefined} />
      {overdue && <QueueRow href="/finance?status=overdue" label="Overdue invoices" hint="Sent, past the due date" icon={CalendarClock} tone="danger" count={overdue.count} sum={overdue.amount} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fleet snapshot (roles without the live map)                         */
/* ------------------------------------------------------------------ */

const MOTION: { key: "rolling" | "idle" | "stopped" | "inService"; label: string; tone: Tone; faded?: boolean }[] = [
  { key: "rolling", label: "Rolling", tone: "progress" },
  { key: "idle", label: "Idle", tone: "info" },
  { key: "stopped", label: "Stopped", tone: "info", faded: true },
  { key: "inService", label: "In service", tone: "warn" },
];

/** The live map's legend as static numbers, for roles that cannot open /tracking or poll /api/fleet. */
export function FleetSummary({ legend: f }: { legend: FleetLegend }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {MOTION.map((m) => (
          <div key={m.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              <StatusDot tone={m.tone} className={cn(m.faded && "opacity-50")} />{m.label}
            </dt>
            <dd className="num mt-0.5 text-[18px] font-semibold text-fg">{f[m.key]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] text-fg-muted">
        <span className="num">{f.onLoad}</span> of <span className="num">{plural(f.trucks, "truck")}</span> on loads
        {f.late > 0 && <> · <span className="num text-danger">{f.late} running late</span></>}
        {f.noSignal > 0 && <> · <span className="num text-warn">{f.noSignal} no signal</span></>}
      </p>
      <p className="mt-1 text-[12px] text-fg-subtle">As of this page load.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* This week production                                                */
/* ------------------------------------------------------------------ */

export function WeekProduction({ week, showMoney }: { week: Weekly; showMoney: boolean }) {
  const rows = week.groups.flatMap((g) => g.rows);
  const goal = rows.reduce((a, r) => a + r.goal, 0);
  const producing = rows.filter((r) => r.total > 0).length;
  const reach = goal ? week.grand.total / goal : 0;
  const tone = reach >= 1 ? "ok" : reach >= 0.6 ? "progress" : "warn";
  const loads = rows.reduce((a, r) => a + r.days.reduce((b, d) => b + d.loads.length, 0), 0);
  const cells: [string, ReactNode][] = showMoney
    ? [["Revenue", money(week.grand.total)], ["Distance", km(week.grand.km)], ["Per km", money2(week.grand.rpk)], ["Per driver", money(week.grand.avgPerTruck)]]
    : [["Distance", km(week.grand.km)], ["Loads", String(loads)]];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {cells.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[12px] text-fg-muted">{k}</dt>
            <dd className="num mt-0.5 truncate text-[16px] font-semibold text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px]">
          <span className="truncate text-fg-muted">Weekly goal · {producing} of {plural(week.grand.drivers, "driver")} producing</span>
          <span className="num font-medium text-fg">{Math.round(reach * 100)}%</span>
        </div>
        <Progress value={reach} tone={tone} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming pickups                                                    */
/* ------------------------------------------------------------------ */

/** "Today" / "Tomorrow" / "Wed 7 Oct" in company time (the server clock runs in the company zone). */
const dayLabel = (d: Date, now: Date) => (isSameDay(d, now) ? "Today" : isSameDay(d, addDays(now, 1)) ? "Tomorrow" : format(d, "EEE d MMM"));
function lateBy(d: Date, now: Date) {
  const mins = Math.max(1, Math.round((now.getTime() - d.getTime()) / 60_000));
  return mins < 60 ? `${mins} min late` : mins < 48 * 60 ? `${Math.round(mins / 60)} h late` : `${Math.round(mins / 1440)} d late`;
}

export function UpcomingPickups({ loads, total, now, canEdit }: { loads: UpcomingPickup[]; total: number; now: Date; canEdit: boolean }) {
  if (loads.length === 0) {
    return (
      <EmptyState
        title="No pickups in the next 24 hours"
        description="Loads with a later pickup are on the dispatch board's prebook view."
        action={canEdit ? <LinkButton href="/loads/new" variant="secondary" size="sm">New load</LinkButton> : <LinkButton href="/loads" variant="secondary" size="sm">All loads</LinkButton>}
      />
    );
  }
  const more = total - loads.length;
  return (
    <>
      <ul className="divide-y divide-line">
        {loads.map((l) => {
          const late = l.pickupAt < now;
          return (
            <li key={l.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2 md:grid-cols-[72px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
              <Link href={`/loads/${l.id}`} className="min-w-0">
                <span className="num block text-[13px] font-medium text-fg">{format(l.pickupAt, "HH:mm")}</span>
                <span className={cn("block truncate text-[12px]", late ? "text-danger" : "text-fg-subtle")}>{late ? lateBy(l.pickupAt, now) : dayLabel(l.pickupAt, now)}</span>
              </Link>
              <Link href={`/loads/${l.id}`} className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="num truncate text-[13px] font-medium text-fg">{l.reference}</span>
                  {(l.priority === "URGENT" || l.priority === "HIGH") && <Chip tone={l.priority === "URGENT" ? "danger" : "warn"}>{l.priority === "URGENT" ? "Urgent" : "High"}</Chip>}
                  {l.hazmat && <Chip tone="warn">Hazmat</Chip>}
                </span>
                <span className="block truncate text-[12px] text-fg-subtle" title={l.commodity}>{l.originCity} → {l.destCity}</span>
              </Link>
              <span className="hidden min-w-0 truncate text-[13px] text-fg-muted md:block" title={l.customer.name}>{l.customer.name}</span>
              <div className="min-w-0 text-right md:text-left">
                {l.truck ? (
                  <>
                    <span className="flex min-w-0 items-center justify-end gap-1.5 text-[13px] md:justify-start">
                      <span className="num text-fg">{l.truck.unitNumber}</span>
                      <span className="truncate text-fg-muted">{l.driver?.name ?? "no driver"}</span>
                      {l.driver?.hold && <Chip tone="warn">Hold</Chip>}
                    </span>
                    {l.team && (
                      <span className="flex items-center justify-end gap-1.5 truncate text-[12px] text-fg-subtle md:justify-start">
                        {l.team.color && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: l.team.color }} aria-hidden />}
                        {l.team.name}
                      </span>
                    )}
                  </>
                ) : canEdit ? (
                  <Link href={`/loads/${l.id}/edit`} className={buttonClass("secondary", "sm")}>Assign truck</Link>
                ) : (
                  <span className="text-[12px] text-fg-subtle">No truck yet</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Link href="/dispatch" className="block border-t border-line px-4 py-2 text-[12px] text-fg-muted transition-colors hover:bg-raised hover:text-fg">
          <span className="num">{plural(more, "more pickup")}</span> on the dispatch board
        </Link>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                     */
/* ------------------------------------------------------------------ */

const EVENT_ICON: Record<string, LucideIcon> = {
  CREATED: PackagePlus, ASSIGNED: UserCheck, STATUS: ArrowRightLeft, NOTE: StickyNote, CHECK_CALL: Phone,
  ISSUE: TriangleAlert, DOCUMENT: FileText, BILLING: Receipt, EDIT: Pencil,
};

export function RecentActivity({ events }: { events: RecentEvent[] }) {
  if (events.length === 0) return <EmptyState title="No activity yet" description="Load updates from dispatchers and drivers appear here." />;
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.type] ?? ArrowRightLeft;
        return (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2">
            <IconTile size="sm" tone={e.type === "ISSUE" ? "danger" : "neutral"}><Icon aria-hidden /></IconTile>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-fg" title={e.message}>
                <Link href={`/loads/${e.load.id}`} className="num font-medium hover:text-accent-text">{e.load.reference}</Link>
                <span className="text-fg-muted"> · {e.message}</span>
              </p>
              <p className="text-[12px] text-fg-subtle">{e.user?.name ?? "System"} · {ago(e.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
