import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Building2, Check, Container, Droplet, Truck, User, type LucideIcon } from "lucide-react";
import { Chip, EmptyState, IconTile, LinkButton, Progress, StatusDot, cardClass, cn, type Hue, type Tone } from "@/components/ui";
import { REPAIR_STAGE_LABELS, humanize, type Role } from "@/lib/constants";
import type { Formatter } from "@/lib/locale";
import { roLabel } from "@/lib/service";
import { can, canOpen, type Permission } from "@/lib/permissions";
import { lastUpdateOf, vendorOf, type OpenRepair, type PaperworkItem, type PaperworkOwner, type Today } from "@/lib/alerts";
import type { MonthSpend, SetupProgress } from "./queries";
import { daysBetween, daysUntil, downtime, pct } from "./lib";

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
/* Fleet today: eight tiles                                            */
/* ------------------------------------------------------------------ */

export type Tile = {
  key: string; label: string; value: ReactNode; href?: string; icon: LucideIcon; hue: Hue;
  /** Context line. Shown under the number when `alert` is set; otherwise it is the tile's hover tip. */
  sub?: ReactNode; alert?: boolean;
};

/** Eight numbers, four to a row: a coloured icon per number, words only where something needs a look. */
export function TileGrid({ items }: { items: Tile[] }) {
  return (
    <section aria-label="Fleet today" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((k) => {
        const Icon = k.icon;
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <IconTile tone={k.hue}><Icon aria-hidden /></IconTile>
              {k.href && <ArrowUpRight aria-hidden className="h-4 w-4 text-fg-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100" />}
            </div>
            <p className="num mt-3 truncate text-[26px] font-semibold leading-none tracking-[-0.025em] text-fg">{k.value}</p>
            <p className="mt-1.5 truncate text-[12px] font-medium text-fg-muted" title={k.label}>{k.label}</p>
            {k.sub && (k.alert
              ? <p className="mt-0.5 truncate text-[12px] text-fg-subtle">{k.sub}</p>
              : (
                <span role="tooltip" className="pointer-events-none absolute left-3 top-full z-30 mt-1 w-max max-w-[calc(100%-1.5rem)] rounded-md bg-fg px-2 py-1 text-[11px] leading-4 text-surface opacity-0 shadow-float transition-opacity duration-150 group-hover:opacity-100 [&_*]:!text-surface">
                  {k.sub}
                </span>
              ))}
          </>
        );
        const tile = cn("group relative block min-w-0 px-4 py-3.5", cardClass);
        return k.href ? (
          <Link key={k.key} href={k.href}
            className={cn(tile, "transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40")}>
            {body}
          </Link>
        ) : (
          <div key={k.key} className={tile}>{body}</div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Metric list (label · value · note)                                  */
/* ------------------------------------------------------------------ */

export type Metric = { label: string; value: ReactNode; note?: ReactNode; noteTone?: SubTone; href?: string; strong?: boolean };

export function MetricList({ items, className }: { items: Metric[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((m) => {
        const row = (
          <>
            <dt className={cn("min-w-0 truncate text-[13px]", m.strong ? "font-medium text-fg" : "text-fg-muted")}>{m.label}</dt>
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
/* In the shop                                                         */
/* ------------------------------------------------------------------ */

const SHOW_SHOP = 6;

/** Units at a shop now, earliest promised date first: shop, stage, when it is promised back and how long it has been down. */
export function InShop({ jobs, now, f, canEdit }: { jobs: OpenRepair[]; now: Date; f: Formatter; canEdit: boolean }) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="Nothing in the shop"
        description="When a unit goes in, open a repair: it shows here with the shop, its stage, the promised date and the downtime."
        action={canEdit ? <LinkButton href="/maintenance/work-orders/new" variant="secondary" size="sm">New repair</LinkButton> : undefined}
      />
    );
  }
  const more = jobs.length - SHOW_SHOP;
  return (
    <ul className="divide-y divide-line">
      {jobs.slice(0, SHOW_SHOP).map((w) => {
        const unit = w.truck?.unitNumber ?? w.trailer?.unitNumber ?? "No unit";
        const late = w.promisedAt && w.promisedAt < now ? daysBetween(w.promisedAt, now) : null;
        const stage = w.stage ? REPAIR_STAGE_LABELS[w.stage] ?? humanize(w.stage) : "In the shop";
        const since = w.inAt ?? w.createdAt;
        const quiet = daysBetween(lastUpdateOf(w), now);
        return (
          <li key={w.id}>
            <Link href={`/maintenance/work-orders/${w.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 transition-colors hover:bg-raised">
              <span className="min-w-0">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="num truncate text-[13px] font-medium text-fg">{unit}</span>
                  <span className="num shrink-0 text-[11px] text-fg-subtle">{roLabel(w.number)}</span>
                  {w.stage === "WAITING_APPROVAL" && <Chip tone="warn">Needs approval</Chip>}
                </span>
                <span className="block truncate text-[12px] text-fg-subtle" title={`${w.title}${quiet >= 3 ? ` · no update for ${quiet} days` : ""}`}>
                  {vendorOf(w) ?? "No shop set"} · {stage}
                </span>
              </span>
              <span className="text-right">
                <span className={cn("num block whitespace-nowrap text-[12px]", late != null ? "font-medium text-danger" : "text-fg-muted")}>
                  {w.promisedAt ? (late != null ? (late ? `${late} d past ${f.day(w.promisedAt)}` : "due back today") : `back ${f.day(w.promisedAt)}`) : "no promised date"}
                </span>
                <span className="num block whitespace-nowrap text-[11px] text-fg-subtle" title={`In the shop since ${f.dateTime(since)}`}>down {downtime(since, now)}</span>
              </span>
            </Link>
          </li>
        );
      })}
      {more > 0 && (
        <li>
          <Link href="/maintenance/work-orders?status=IN_PROGRESS" className="block px-4 py-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">All {jobs.length} in the shop →</Link>
        </li>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* This month's spend                                                  */
/* ------------------------------------------------------------------ */

/** Maintenance and fuel this month so far, with last month beside each; driver charges and cost per distance when known. */
export function Spend({ spend, f, role }: { spend: MonthSpend; f: Formatter; role: Role }) {
  const cur = spend.thisMonth;
  const prev = spend.lastMonth;
  const short = (label: string) => label.slice(0, 3);
  const perThis = cur.distance > 0 ? cur.total / cur.distance : null;
  const perLast = prev.distance > 0 ? prev.total / prev.distance : null;
  const perDelta = perThis != null && perLast ? Math.round(((perThis - perLast) / perLast) * 100) : null;
  const to = (href: string) => (canOpen(role, href) ? href : undefined);
  const items: Metric[] = [
    { label: "Maintenance", value: f.money(cur.maintenance), note: `${short(prev.label)} ${f.money(prev.maintenance)}`, href: to("/maintenance") },
    { label: "Fuel", value: f.money(cur.fuel), note: `${short(prev.label)} ${f.money(prev.fuel)}`, href: to("/reports") },
    { label: "Total", value: f.money(cur.total), note: `${short(prev.label)} ${f.money(prev.total)}`, strong: true },
  ];
  if (cur.driverCharges > 0) items.push({ label: "Charged to drivers", value: f.money(cur.driverCharges), href: to("/maintenance/work-orders") });
  if (perThis != null) {
    items.push({
      label: `Cost ${f.labels.perDistance}`, value: f.money2(perThis),
      // Lower is better: a rise is red, a drop green.
      note: perDelta ? `${pct(perDelta)} vs ${short(prev.label)}` : undefined, noteTone: perDelta ? (perDelta > 0 ? "danger" : "ok") : undefined,
    });
  }
  return <MetricList items={items} />;
}

/* ------------------------------------------------------------------ */
/* Coming up                                                           */
/* ------------------------------------------------------------------ */

const OWNER_ICON: Record<PaperworkOwner, LucideIcon> = { truck: Truck, trailer: Container, driver: User, company: Building2 };

const SHOW_PAPERS = 6;
const SHOW_OIL = 5;

/**
 * The next 30 days, soonest first: papers about to expire (already expired sits in the decisions), then trucks inside
 * the oil window by odometer, each with a way to book it.
 */
export function ComingUp({ papers, oil, now, f, role, canEdit }: { papers: PaperworkItem[]; oil: Today["oilSoon"]; now: Date; f: Formatter; role: Role; canEdit: boolean }) {
  if (papers.length === 0 && oil.length === 0) {
    return (
      <EmptyState
        title="Nothing due in the next 30 days"
        description="Paper expiries and oil services by odometer show up here a month ahead, so there is time to book them."
      />
    );
  }
  const morePapers = papers.length - SHOW_PAPERS;
  const moreOil = oil.length - SHOW_OIL;
  return (
    <ul className="divide-y divide-line">
      {papers.length > 0 && (
        <>
          <GroupHead tone="warn" label="Papers expiring" count={papers.length}
            more={morePapers > 0 && canOpen(role, "/maintenance?tab=compliance") ? { href: "/maintenance?tab=compliance", label: `${morePapers} more` } : undefined} />
          {papers.slice(0, SHOW_PAPERS).map((p, i) => {
            const Icon = OWNER_ICON[p.owner];
            const days = daysUntil(p.expiresAt, now);
            const row = (
              <>
                <span className="min-w-0">
                  <span className="num block text-[13px] font-medium text-fg">{f.day(p.expiresAt)}</span>
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
        </>
      )}
      {oil.length > 0 && (
        <>
          <GroupHead tone="info" label="Oil service by odometer" count={oil.length}
            more={moreOil > 0 ? { href: "/maintenance/oil", label: `${moreOil} more` } : undefined} />
          {oil.slice(0, SHOW_OIL).map((t) => (
            <li key={t.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2">
              <Link href={`/fleet/${t.id}`} className="num truncate text-[13px] font-medium text-fg hover:text-accent-text">{t.unitNumber}</Link>
              <span className="flex min-w-0 items-center gap-2">
                <Droplet aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <span className="num truncate text-[13px] text-fg-muted" title={t.dueAtKm != null ? `Due at ${f.dist(t.dueAtKm)}` : undefined}>In {f.dist(t.left)}</span>
              </span>
              {t.booked ? (
                <Link href={`/maintenance/work-orders/${t.booked.id}`} className="whitespace-nowrap text-[12px] text-fg-subtle hover:text-fg">
                  Booked <span className="num">{f.day(t.booked.scheduledAt)}</span>
                </Link>
              ) : canEdit ? (
                <LinkButton href={`/maintenance/oil?book=${t.id}`} variant="secondary" size="sm">Book</LinkButton>
              ) : (
                <span className="text-[12px] text-fg-subtle">Not booked</span>
              )}
            </li>
          ))}
        </>
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
    { key: "truck", title: "Add a truck", description: "Unit number, plate, odometer and its truck type for the oil interval. Its paper dates drive the expiry reminders.", href: "/fleet/new", cta: "Add a truck", perm: "fleet.edit", done: progress.trucks > 0 },
    { key: "trailer", title: "Add a trailer", description: "Pair it with a truck so it travels with its tractor on the live map.", href: "/fleet/trailers/new", cta: "Add a trailer", perm: "fleet.edit", done: progress.trailers > 0 },
    { key: "driver", title: "Add a driver", description: "Licence and medical expiry dates, then put them on a truck so walk-arounds can be chased.", href: "/drivers/new", cta: "Add a driver", perm: "drivers.edit", done: progress.drivers > 0 },
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
              ? `Everything is in place for ${company}. Today now shows what needs a decision each day.`
              : fresh
                ? `Welcome to ${company}. Add your units and people, and this page starts showing what needs a decision each day: oil, walk-arounds, papers, the shop and the live map.`
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
          <LinkButton href="/dashboard" variant="secondary" size="sm">Go to Today</LinkButton>
        </div>
      )}
    </section>
  );
}
