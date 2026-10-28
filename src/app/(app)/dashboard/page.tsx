import { cookies } from "next/headers";
import { ClipboardCheck, Droplet, FileWarning, Gauge, PackageSearch, Plus, ShieldCheck, Video, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFormat } from "@/lib/format-server";
import { fleetSnapshot } from "@/lib/telemetry";
import { getPaperwork, getToday } from "@/lib/alerts";
import { OIL_DUE_NOW, OIL_DUE_SOON } from "@/lib/service";
import { Card, EmptyState, InfoTip, LinkButton, PageHeader, cn } from "@/components/ui";
import { LiveFleetMini } from "@/components/live-fleet";
import { isDecisionCategory } from "./decision-types";
import { DecisionsTable } from "./decisions";
import { CustomizeOverview } from "./customize";
import { OVERVIEW_COOKIE, parseHidden, type OverviewSection } from "./sections";
import { ComingUp, Flag, InShop, MoreLink, SetupChecklist, Spend, TileGrid, type Tile } from "./panels";
import { monthSpend, setupProgress } from "./queries";
import { canOpen, daysBetween, plural, visibleDecisions } from "./lib";

export const metadata = { title: "Today" };

const none = Promise.resolve(null);

/**
 * Today, top to bottom: the fleet in eight numbers (each opens the page where it is acted on); then "Needs a decision
 * today" — every open item with the one button that sorts it — over the live map, beside the shop, this month's spend
 * and what is coming up in the next 30 days. A company with no trucks and no drivers yet (or `?welcome=1`) gets the
 * set-up checklist. Each person can hide sections (Customize, saved in a cookie); hidden sections are not queried.
 * The rows, the tiles and the alert bell come from one computation (getToday in src/lib/alerts.ts), so they agree.
 * `?cat=oil|shop|documents|pti|drivers|fleet` opens the table on a category.
 */
export default async function TodayPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("dashboard.view");
  const sp = await searchParams;
  const hidden = parseHidden((await cookies()).get(OVERVIEW_COOKIE)?.value);
  const show = (s: OverviewSection) => !hidden.has(s);
  const canEdit = can(user.role, "fleet.edit");
  const seesMoney = can(user.role, "money.view");
  const seesTracking = can(user.role, "tracking.view");
  // Links only go where this role can go; requireUser would bounce anything else straight back here.
  const to = (href: string) => (canOpen(user.role, href) ? href : undefined);
  const welcome = sp.welcome === "1";
  const cat = typeof sp.cat === "string" && isDecisionCategory(sp.cat) ? sp.cat : "all";

  const f = await getFormat();
  const [setup, today, papers, fleet, spend] = await Promise.all([
    setupProgress(user.company.id),
    getToday(), // shared with the alert bell in the same request (cached)
    show("upcoming") ? getPaperwork() : none,
    show("fleet") ? fleetSnapshot() : none,
    show("costs") && seesMoney ? monthSpend(f, new Date()) : none,
  ]);
  const now = today.at;
  const title = `${user.company.name} today`;

  /* ---------- A company with nothing in it yet: the checklist is the page ---------- */
  if (setup.trucks === 0 && setup.drivers === 0) {
    return (
      <>
        <PageHeader title={title} subtitle={f.weekday(now)} />
        <SetupChecklist company={user.company.name} progress={setup} role={user.role} fresh />
      </>
    );
  }

  const subtitle = [f.weekday(now), plural(today.counts.trucks, "truck"), plural(today.counts.trailers, "trailer")].join(" · ");
  const rows = visibleDecisions(today.decisions, user.role);

  /* ---------- Fleet today: eight tiles ---------- */
  const t = today.tiles;
  const toBook = t.oilOverdue - t.oilOverdueBooked;
  const tiles: Tile[] = [
    {
      key: "oil-overdue", label: "Oil change overdue", value: t.oilOverdue, href: to("/maintenance/oil?view=overdue"), icon: Droplet, hue: "hue-4",
      sub: t.oilOverdue
        ? <>{t.oilOverdueBooked ? `${t.oilOverdueBooked} booked` : null}{t.oilOverdueBooked && toBook ? " · " : null}{toBook ? <Flag tone="danger">{toBook} to book</Flag> : null}</>
        : "Every truck is inside its oil interval",
      alert: t.oilOverdue > 0,
    },
    {
      key: "oil-due", label: `Oil due ≤ ${f.dist(OIL_DUE_NOW)}`, value: t.oilDueNow, href: to("/maintenance/oil?view=due"), icon: Gauge, hue: "hue-4",
      sub: t.oilDueSoon ? `${t.oilDueSoon} more within ${f.dist(OIL_DUE_SOON)}` : `Nothing else within ${f.dist(OIL_DUE_SOON)}`,
      alert: t.oilDueNow > 0 || t.oilDueSoon > 0,
    },
    {
      key: "pti", label: "PTI issues unresolved", value: t.ptiUnassigned, href: to("/inspections/defects?view=unassigned"), icon: ClipboardCheck, hue: "hue-3",
      sub: t.trucksHeld
        ? <Flag tone="danger">{plural(t.trucksHeld, "truck")} held out of service</Flag>
        : t.ptiUnassigned ? "Found on walk-arounds, no owner and no repair yet" : "Every walk-around issue has an owner or a repair",
      alert: t.ptiUnassigned > 0 || t.trucksHeld > 0,
    },
    {
      key: "walk", label: "Walk-arounds missing", value: t.walkMissing, href: to("/inspections"), icon: Video, hue: "hue-3",
      sub: <>due {f.weekday(t.walkDue)} · {t.walkToReview ? <Flag tone="warn">{t.walkToReview} to review</Flag> : "none to review"}</>,
      alert: true,
    },
    {
      key: "parts", label: "Waiting on parts", value: t.waitingParts, href: to("/maintenance/work-orders?status=IN_PROGRESS&stage=WAITING_PARTS"), icon: PackageSearch, hue: "hue-2",
      sub: t.waitingPartsSince ? `longest ${daysBetween(t.waitingPartsSince, now)} d` : "No repair is held up by parts",
      alert: t.waitingParts > 0,
    },
    {
      key: "docs", label: "Documents holding dispatch", value: t.docsHolding,
      href: show("attention") ? "/dashboard?cat=documents#decisions" : "/dashboard/alerts?cat=documents", icon: FileWarning, hue: "hue-1",
      sub: t.docsHolding
        ? <>{t.docsExpired ? <Flag tone="danger">{t.docsExpired} expired</Flag> : null}{t.docsExpired && t.docsMissing ? " · " : null}{t.docsMissing ? `${t.docsMissing} missing a paper` : null}</>
        : "Registration, annual inspection and insurance valid on every unit",
      alert: t.docsHolding > 0,
    },
    {
      key: "shop", label: "In the shop now", value: t.inShop, href: to("/maintenance/work-orders?status=IN_PROGRESS"), icon: Wrench, hue: "hue-2",
      sub: t.inShopLate ? <Flag tone="danger">{t.inShopLate} past promised date</Flag> : t.inShop ? "Every repair is on time" : "Nothing at a shop",
      alert: t.inShopLate > 0,
    },
    {
      key: "dot", label: "Annual DOT due in 30 days", value: t.dotSoon, href: to("/maintenance?tab=compliance"), icon: ShieldCheck, hue: "hue-1",
      sub: t.dotExpired
        ? <Flag tone="danger">{t.dotExpired} already expired</Flag>
        : t.dotSoon ? "Annual inspections expiring: book them" : "No annual inspection expires in the next 30 days",
      alert: t.dotSoon > 0 || t.dotExpired > 0,
    },
  ];

  /* ---------- Cards ---------- */
  const decisions = show("attention") && <DecisionsTable key={cat} rows={rows} canEdit={canEdit} initialCategory={cat} />;
  const map = show("fleet") && fleet && (
    <Card title="Live fleet" bodyClassName="p-1.5 pt-1" actions={seesTracking ? <MoreLink href="/tracking">Live map</MoreLink> : undefined}>
      {fleet.length
        ? <LiveFleetMini initial={fleet} at={now.toISOString()} height={300} live={seesTracking} />
        : <EmptyState title="No trucks in service" description="Trucks that are active, in the shop or out of service appear on the map." action={canEdit ? <LinkButton href="/fleet/new" variant="secondary" size="sm">Add a truck</LinkButton> : undefined} />}
    </Card>
  );
  const shop = show("today") && (
    <Card flush
      title={<span className="flex items-center gap-2">In the shop{today.inShop.length > 0 && <span className="num rounded-full bg-neutral-soft px-1.5 text-[11px] font-medium leading-5 text-fg-muted">{today.inShop.length}</span>}</span>}
      actions={to("/maintenance/work-orders") ? <MoreLink href="/maintenance/work-orders?status=IN_PROGRESS">Repairs</MoreLink> : undefined}>
      <div className="border-t border-line"><InShop jobs={today.inShop} now={now} f={f} canEdit={canEdit} /></div>
    </Card>
  );
  const spendCard = show("costs") && (
    <Card
      title={<span className="flex items-center gap-1.5">This month&apos;s spend{seesMoney && <InfoTip>Maintenance is completed repairs by completion date (the invoice total, else the job cost); fuel is every fill by date. This month runs to today, in company time; last month is the whole month. Cost per distance divides both by the distance driven, from odometer readings.</InfoTip>}</span>}
      actions={spend ? <span className="num rounded-full bg-neutral-soft px-2 text-[11px] leading-5 text-fg-muted">{spend.thisMonth.label}</span> : undefined}
      bodyClassName={seesMoney ? "px-4 pb-3 pt-0" : undefined}>
      {spend
        ? <Spend spend={spend} f={f} role={user.role} />
        : <p className="text-[12px] text-fg-subtle">Costs, invoices and spend aren&apos;t shown for view-only members. An owner, admin or fleet specialist sees them here.</p>}
    </Card>
  );
  const upcoming = show("upcoming") && papers && (
    <Card flush title={<span className="flex items-center gap-1.5">Coming up<InfoTip>Papers expiring in the next 30 days and trucks within {f.dist(OIL_DUE_SOON)} of their oil service. Anything already expired, missing or due now is under Needs a decision today.</InfoTip></span>}
      actions={<span className="num rounded-full bg-neutral-soft px-2 text-[11px] leading-5 text-fg-muted">Next 30 days</span>}>
      <div className="border-t border-line">
        <ComingUp papers={papers.filter((p) => !p.expired)} oil={today.oilSoon} now={now} f={f} role={user.role} canEdit={canEdit} />
      </div>
    </Card>
  );

  const hasMain = Boolean(decisions || map);
  const hasAside = Boolean(shop || spendCard || upcoming);
  // Trucks but no drivers (or the other way round) is still setting up; a view-only member can't help, so it stays quiet for them.
  const setupLeft = welcome || ((setup.trucks === 0 || setup.drivers === 0) && (canEdit || can(user.role, "drivers.edit")));
  const nothing = !show("numbers") && !hasMain && !hasAside;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <CustomizeOverview hidden={[...hidden]} />
            {to("/inspections") && <LinkButton href="/inspections" variant="secondary"><ClipboardCheck />Pre-trip board</LinkButton>}
            {canEdit && <LinkButton href="/maintenance/work-orders/new"><Plus />New repair</LinkButton>}
          </>
        }
      />

      <div className="space-y-4">
        {setupLeft && <SetupChecklist company={user.company.name} progress={setup} role={user.role} fresh={false} />}

        {show("numbers") && <TileGrid items={tiles} />}

        {/* Two columns that flow independently: what to decide (and the map) on the left, the shop, the money and what
            is coming on the right. On a phone the decisions come first. */}
        {(hasMain || hasAside) && (
          <div className={cn("grid items-start gap-4", hasMain && hasAside && "xl:grid-cols-3")}>
            {hasMain && <div className={cn("grid min-w-0 gap-4", hasAside && "xl:col-span-2")}>{decisions}{map}</div>}
            {hasAside && <div className={cn("grid min-w-0 gap-4", !hasMain && "md:grid-cols-2 xl:grid-cols-3")}>{shop}{spendCard}{upcoming}</div>}
          </div>
        )}

        {nothing && (
          <Card>
            <EmptyState title="Today is empty" description="Every section is hidden. Use Customize to bring back the ones you want." />
          </Card>
        )}
      </div>
    </>
  );
}
