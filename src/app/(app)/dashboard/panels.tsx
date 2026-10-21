import Link from "next/link";
import type { ReactNode } from "react";
import { format } from "date-fns";
import { ArrowUpRight, Building2, Check, Container, Gauge, Truck, User, type LucideIcon } from "lucide-react";
import { Chip, EmptyState, IconTile, LinkButton, Progress, StatusDot, cardClass, cn, type Hue, type Tone } from "@/components/ui";
import { WORK_ORDER_CATEGORY_LABELS, type Role } from "@/lib/constants";
import { number } from "@/lib/format";
import { can, canOpen, type Permission } from "@/lib/permissions";
import type { PaperworkItem, PaperworkOwner } from "@/lib/alerts";
import type { SetupProgress, ShopDay, ShopJob } from "./queries";
import { daysBetween, daysUntil, plural } from "./lib";

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
};

/** The fleet in six numbers: one tile each, a coloured icon per number, words only where something needs a look. */
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
            <p className="num mt-3 truncate text-[26px] font-semibold leading-none tracking-[-0.025em] text-fg">{k.value}</p>
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
/* Small list pieces                                                   */
/* ------------------------------------------------------------------ */

/** Sub-heading inside a list card: dot, label, count and an "All N" link when the list is cut short. */
function GroupHead({ tone, label, count, more }: { tone: Tone; label: string; count: number; more?: { href: string; label: string } }) {
  return (
    <li className="flex items-center justify-between gap-2 bg-raised/60 px-4 py-1.5">
      <span className="flex items-center gap-2 text-[12px] font-medium text-fg-muted">
        <StatusDot tone={tone} />{label}<span className="num text-fg-subtle">{count}</span>
      </span>
      {more && <Link href={more.href} className="whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">{more.label} →</Link>}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Today in the shop                                                   */
/* ------------------------------------------------------------------ */

type JobKind = "progress" | "overdue" | "today";

function unitOf(job: ShopJob) {
  if (job.truck) return { label: job.truck.unitNumber, href: `/fleet/${job.truck.id}` };
  if (job.trailer) return { label: job.trailer.unitNumber, href: `/fleet/trailers/${job.trailer.id}` };
  return null;
}

function jobWhen(job: ShopJob, kind: JobKind, now: Date) {
  if (kind === "today") return format(job.scheduledAt, "HH:mm");
  if (kind === "overdue") return `${Math.max(1, daysBetween(job.scheduledAt, now))} d late`;
  const since = job.inAt ?? job.scheduledAt;
  const d = daysBetween(since, now);
  return d === 0 ? `since ${format(since, "HH:mm")}` : `in shop ${d} d`;
}

function JobRow({ job, kind, now, canEdit }: { job: ShopJob; kind: JobKind; now: Date; canEdit: boolean }) {
  const unit = unitOf(job);
  const href = `/maintenance/work-orders/${job.id}`;
  const urgent = job.priority === "URGENT" || job.priority === "HIGH";
  return (
    <li className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2">
      <div className="min-w-0">
        {unit
          ? <Link href={unit.href} className="num block truncate text-[13px] font-medium text-fg hover:text-accent-text">{unit.label}</Link>
          : <span className="block truncate text-[13px] text-fg-faint">No unit</span>}
        <span className={cn("num block truncate text-[12px]", kind === "overdue" ? "text-danger" : "text-fg-subtle")}>{jobWhen(job, kind, now)}</span>
      </div>
      <Link href={href} className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="num shrink-0 text-[12px] text-fg-subtle">#{job.number}</span>
          <span className="truncate text-[13px] font-medium text-fg">{job.title}</span>
          {urgent && <Chip tone={job.priority === "URGENT" ? "danger" : "warn"}>{job.priority === "URGENT" ? "Urgent" : "High"}</Chip>}
        </span>
        <span className="block truncate text-[12px] text-fg-subtle">
          {WORK_ORDER_CATEGORY_LABELS[job.category] ?? job.category}{job.vendor ? ` · ${job.vendor}` : ""}{job.status === "DRAFT" ? " · draft" : ""}
        </span>
      </Link>
      {canEdit
        ? <LinkButton href={href} variant="secondary" size="sm" title={`Open #${job.number} to ${kind === "progress" ? "complete" : "start"} it`}>{kind === "progress" ? "Complete" : "Start"}</LinkButton>
        : <Link href={href} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open →</Link>}
    </li>
  );
}

/** Jobs in the shop now, then late ones, then today's bookings: each with the one button that moves it on. */
export function ShopToday({ day, now, canEdit }: { day: ShopDay; now: Date; canEdit: boolean }) {
  const groups: { kind: JobKind; label: string; tone: Tone; jobs: ShopJob[]; total: number; href: string }[] = [
    { kind: "progress", label: "In progress", tone: "progress", jobs: day.inProgress, total: day.counts.inProgress, href: "/maintenance/work-orders?status=IN_PROGRESS" },
    { kind: "overdue", label: "Overdue, not started", tone: "danger", jobs: day.overdue, total: day.counts.overdue, href: "/maintenance/work-orders" },
    { kind: "today", label: "Booked for today", tone: "info", jobs: day.today, total: day.counts.today, href: "/maintenance/work-orders" },
  ];
  const shown = groups.filter((g) => g.total > 0);
  if (shown.length === 0) {
    return (
      <EmptyState
        title="Nothing in the shop today"
        description="No work in progress and nothing booked for today. Book PM and repairs as work orders and they show up here on the day."
        action={canEdit
          ? <LinkButton href="/maintenance/work-orders/new" variant="secondary" size="sm">New work order</LinkButton>
          : <LinkButton href="/maintenance/work-orders" variant="secondary" size="sm">All work orders</LinkButton>}
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {shown.map((g) => (
        <GroupRows key={g.kind} head={<GroupHead tone={g.tone} label={g.label} count={g.total} more={g.total > g.jobs.length ? { href: g.href, label: `All ${g.total}` } : undefined} />}>
          {g.jobs.map((j) => <JobRow key={j.id} job={j} kind={g.kind} now={now} canEdit={canEdit} />)}
        </GroupRows>
      ))}
    </ul>
  );
}

/** A heading row followed by its rows, flattened into the parent list (no nested lists for screen readers to walk). */
function GroupRows({ head, children }: { head: ReactNode; children: ReactNode }) {
  return <>{head}{children}</>;
}

/* ------------------------------------------------------------------ */
/* Coming up                                                           */
/* ------------------------------------------------------------------ */

const OWNER_ICON: Record<PaperworkOwner, LucideIcon> = { truck: Truck, trailer: Container, driver: User, company: Building2 };

export type PmDue = { id: string; unitNumber: string; leftKm: number; booked: { id: string; number: number; scheduledAt: Date } | null };

const SHOW_PAPERS = 6;
const SHOW_PM = 5;

/**
 * The next 30 days, soonest first: paperwork that is about to expire (already expired sits in Needs attention), then
 * trucks close to their PM by odometer, each with a way to book it.
 */
export function ComingUp({ papers, pm, now, role, canEdit }: { papers: PaperworkItem[]; pm: PmDue[]; now: Date; role: Role; canEdit: boolean }) {
  if (papers.length === 0 && pm.length === 0) {
    return (
      <EmptyState
        title="Nothing due in the next 30 days"
        description="Paperwork expiries and PM services by odometer show up here a month ahead, so there is time to book them."
      />
    );
  }
  const morePapers = papers.length - SHOW_PAPERS;
  const morePm = pm.length - SHOW_PM;
  return (
    <ul className="divide-y divide-line">
      {papers.length > 0 && (
        <GroupRows head={<GroupHead tone="warn" label="Paperwork expiring" count={papers.length}
          more={morePapers > 0 ? { href: "/dashboard/alerts", label: `${morePapers} more` } : undefined} />}>
          {papers.slice(0, SHOW_PAPERS).map((p, i) => {
            const Icon = OWNER_ICON[p.owner];
            const days = daysUntil(p.expiresAt, now);
            const row = (
              <>
                <span className="min-w-0">
                  <span className="num block text-[13px] font-medium text-fg">{format(p.expiresAt, "d MMM")}</span>
                  <span className={cn("num block text-[12px]", days <= 7 ? "text-warn" : "text-fg-subtle")}>{days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} d`}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                  <span className="truncate text-[13px] text-fg"><span className="font-medium">{p.who}</span><span className="text-fg-muted"> · {p.what}</span></span>
                </span>
              </>
            );
            const cls = "grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 px-4 py-2";
            return (
              <li key={`${p.href}-${p.what}-${i}`}>
                {canOpen(role, p.href) ? <Link href={p.href} className={cn(cls, "transition-colors hover:bg-raised")}>{row}</Link> : <div className={cls}>{row}</div>}
              </li>
            );
          })}
        </GroupRows>
      )}
      {pm.length > 0 && (
        <GroupRows head={<GroupHead tone="info" label="PM by odometer" count={pm.length}
          more={morePm > 0 ? { href: "/maintenance?tab=pm", label: `${morePm} more` } : undefined} />}>
          {pm.slice(0, SHOW_PM).map((t) => (
            <li key={t.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2">
              <Link href={`/fleet/${t.id}`} className="num truncate text-[13px] font-medium text-fg hover:text-accent-text">{t.unitNumber}</Link>
              <span className="flex min-w-0 items-center gap-2">
                <Gauge aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <span className={cn("num truncate text-[13px]", t.leftKm < 500 ? "text-warn" : "text-fg-muted")}>Service in {number(t.leftKm)} km</span>
              </span>
              {t.booked ? (
                <Link href={`/maintenance/work-orders/${t.booked.id}`} className="whitespace-nowrap text-[12px] text-fg-subtle hover:text-fg">
                  Booked <span className="num">{format(t.booked.scheduledAt, "d MMM")}</span>
                </Link>
              ) : canEdit ? (
                <LinkButton href={`/maintenance/work-orders/new?truck=${t.id}&category=PM`} variant="secondary" size="sm">Book PM</LinkButton>
              ) : (
                <span className="text-[12px] text-fg-subtle">Not booked</span>
              )}
            </li>
          ))}
        </GroupRows>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Getting started                                                     */
/* ------------------------------------------------------------------ */

type Step = { key: string; title: string; description: string; href: string; cta: string; perm: Permission; done: boolean };

/**
 * First-run checklist for a new company: each step is done once the record exists, and links to where it is done.
 * Steps this role cannot do say who can; a view-only member sees the progress without buttons.
 */
export function SetupChecklist({ company, progress, role, fresh }: { company: string; progress: SetupProgress; role: Role; fresh: boolean }) {
  const steps: Step[] = [
    { key: "truck", title: "Add a truck", description: "Unit number, plate, odometer and PM interval. Its paperwork dates drive the expiry reminders.", href: "/fleet/new", cta: "Add a truck", perm: "fleet.edit", done: progress.trucks > 0 },
    { key: "trailer", title: "Add a trailer", description: "Pair it with a truck so it travels with its tractor on the live map.", href: "/fleet/trailers/new", cta: "Add a trailer", perm: "fleet.edit", done: progress.trailers > 0 },
    { key: "driver", title: "Add a driver", description: "Licence and medical expiry dates, then put them on a truck.", href: "/drivers/new", cta: "Add a driver", perm: "drivers.edit", done: progress.drivers > 0 },
    { key: "docs", title: "Upload company documents", description: "Company licence, insurance and tax certificate, with their expiry dates.", href: "/admin/company", cta: "Upload documents", perm: "company.manage", done: progress.companyDocs > 0 },
    { key: "invite", title: "Invite a teammate", description: "Fleet specialists can edit everything; view-only members just look.", href: "/admin/members", cta: "Invite someone", perm: "members.manage", done: progress.members > 1 || progress.invites > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  const viewer = !can(role, "fleet.edit");
  const next = steps.find((s) => !s.done && can(role, s.perm));
  return (
    <section aria-labelledby="setup-title" className={cn(cardClass, "overflow-hidden")}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-4">
        <div className="min-w-0 max-w-2xl">
          <h2 id="setup-title" className="text-[15px] font-semibold text-fg">{allDone ? "Your fleet is set up" : "Get your fleet set up"}</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {allDone
              ? `Everything is in place for ${company}. The overview now shows what needs you each day.`
              : fresh
                ? `Welcome to ${company}. Add your units and people, and this page starts showing what needs you each day: PM, paperwork, the shop and the live map.`
                : `A few steps left before ${company} is fully set up.`}
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-44">
          <p className="mb-1.5 flex justify-between text-[12px] text-fg-muted"><span>Progress</span><span className="num font-medium text-fg">{done} of {steps.length}</span></p>
          <Progress value={done / steps.length} tone="ok" />
        </div>
      </header>
      <ol className="divide-y divide-line border-t border-line">
        {steps.map((s, i) => {
          const allowed = can(role, s.perm);
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
              <span aria-hidden className={cn("num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                s.done ? "bg-ok-soft text-ok" : "border border-line-strong text-fg-subtle")}>
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[13px] font-medium", s.done ? "text-fg-muted" : "text-fg")}>
                  {s.title}{s.done && <span className="sr-only"> (done)</span>}
                </p>
                <p className="text-[12px] text-fg-subtle">{s.description}</p>
              </div>
              <div className="ml-9 shrink-0 sm:ml-0">
                {s.done
                  ? <Chip tone="ok">Done</Chip>
                  : allowed
                    ? <LinkButton href={s.href} size="sm" variant={next?.key === s.key ? "primary" : "secondary"}>{s.cta}</LinkButton>
                    : !viewer && <span className="text-[12px] text-fg-subtle">An owner or admin does this</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {viewer && !allDone && (
        <p className="border-t border-line px-5 py-2.5 text-[12px] text-fg-subtle">
          You have view-only access in {company}. An owner, admin or fleet specialist adds the trucks, trailers and drivers.
        </p>
      )}
      {allDone && (
        <div className="border-t border-line px-5 py-3">
          <LinkButton href="/dashboard" variant="secondary" size="sm">Go to the overview</LinkButton>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

/** Context line for a paperwork tile: the expired part in red, the rest plain. */
export function paperworkLine(expired: number, soon: number, noun = "paper") {
  if (expired) return <><Flag tone="danger">{expired} expired</Flag>{soon ? ` · ${soon} expiring` : ""}</>;
  if (soon) return `${plural(soon, noun)} expiring within 30 days`;
  return "Nothing expires in the next 30 days";
}
