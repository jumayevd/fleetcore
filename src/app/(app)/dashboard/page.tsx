import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ClipboardList, FileClock, Gauge, IdCard, Plus, Truck, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fleetSnapshot } from "@/lib/telemetry";
import { getAlerts, getPaperwork } from "@/lib/alerts";
import { km, money, money2 } from "@/lib/format";
import { countByStatus } from "@/components/map/fleet-status";
import { Card, EmptyState, InfoTip, LinkButton, PageHeader, cn } from "@/components/ui";
import { SimpleBar } from "@/components/charts-lazy";
import { ChartEmpty } from "@/components/charts-lite";
import { LiveFleetMini } from "@/components/live-fleet";
import { NeedsAttention } from "./needs-you";
import { CustomizeOverview } from "./customize";
import { OVERVIEW_COOKIE, parseHidden, type OverviewSection } from "./sections";
import { ComingUp, Flag, KpiStrip, MetricList, MoreLink, SetupChecklist, ShopToday, paperworkLine, type Kpi, type Metric, type PmDue } from "./panels";
import { costsByMonth, openPmJobs, setupProgress, shopToday, workOrderCounts } from "./queries";
import { canOpen, greeting, groupAlerts, longDate, pct, plural, visibleAlerts } from "./lib";

export const metadata = { title: "Overview" };

const none = Promise.resolve(null);

/**
 * Overview for a fleet specialist, top to bottom: the fleet in six numbers; two columns (today in the shop over the
 * live map; what needs attention over what is coming up in the next 30 days); then costs. A company with no trucks
 * and no drivers yet (or `?welcome=1`) gets the setup checklist first. Each person can hide sections (Customize,
 * saved in a cookie); hidden sections are not queried. Every figure links to the page where it is acted on, and only
 * where this role can open it.
 */
export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("dashboard.view");
  const sp = await searchParams;
  const hidden = parseHidden((await cookies()).get(OVERVIEW_COOKIE)?.value);
  const show = (s: OverviewSection) => !hidden.has(s);
  const canEdit = can(user.role, "fleet.edit");
  const seesTracking = can(user.role, "tracking.view");
  const now = new Date();
  // Links only go where this role can go; requireUser would bounce anything else straight back here.
  const to = (href: string) => (canOpen(user.role, href) ? href : undefined);

  const welcome = sp.welcome === "1";
  const firstName = user.name.split(" ")[0];

  // Everything in one round trip; for a brand-new company the section queries are empty and cheap.
  const needFleet = show("numbers") || show("fleet") || show("upcoming");
  const needPapers = show("numbers") || show("upcoming");
  const [setup, fleet, rawAlerts, papers, shop, work, costs] = await Promise.all([
    setupProgress(user.company.id),
    needFleet ? fleetSnapshot() : none,
    getAlerts(), // shared with the alert bell in the same request (cached), and feeds the summary line
    needPapers ? getPaperwork() : none,
    show("today") ? shopToday(now) : none,
    show("numbers") ? workOrderCounts(now) : none,
    show("costs") ? costsByMonth(now, 6) : none,
  ]);

  /* ---------- A company with nothing in it yet: the checklist is the page ---------- */
  if (setup.trucks === 0 && setup.drivers === 0) {
    return (
      <>
        <PageHeader title={`${greeting(now)}, ${firstName}`} subtitle={`${longDate(now)} · ${user.company.name}`} />
        <SetupChecklist company={user.company.name} progress={setup} role={user.role} fresh />
      </>
    );
  }

  const pmSoon = fleet && show("upcoming")
    ? fleet.filter((t) => t.pm.state === "due").sort((a, b) => a.pm.leftKm! - b.pm.leftKm!)
    : [];
  const pmBooked = pmSoon.length ? await openPmJobs(pmSoon.map((t) => t.id)) : null;

  const alerts = visibleAlerts(rawAlerts, user.role);

  /* ---------- Fleet figures ---------- */
  const inService = fleet?.filter((t) => t.status === "ACTIVE" && !t.workInProgress) ?? [];
  const available = inService.filter((t) => t.driver && !t.driver.hold).length;
  const noDriver = inService.filter((t) => !t.driver).length;
  const held = inService.filter((t) => t.driver?.hold).length;

  const summary = [
    longDate(now),
    fleet ? `${available} of ${plural(fleet.length, "truck")} available` : null,
    alerts.length ? `${alerts.length} to review` : "all clear",
  ].filter(Boolean).join(" · ");

  /* ---------- Key numbers ---------- */
  let kpis: Kpi[] = [];
  if (show("numbers") && fleet && papers && work) {
    const status = countByStatus(fleet, now.getTime());
    const outOfService = fleet.filter((t) => t.status === "OUT_OF_SERVICE").length;
    const pmOverdue = fleet.filter((t) => t.pm.state === "overdue").length;
    const pmDue = fleet.filter((t) => t.pm.state === "due").length;
    const unitPapers = papers.filter((p) => p.owner !== "driver");
    const unitExpired = unitPapers.filter((p) => p.expired).length;
    const driverPapers = papers.filter((p) => p.owner === "driver");
    const driversAffected = new Set(driverPapers.map((p) => p.ownerId)).size;
    const driversExpired = new Set(driverPapers.filter((p) => p.expired).map((p) => p.ownerId)).size;
    // Each number has its own colour so the row scans at a glance; a line under it appears only when something needs a look.
    kpis = [
      {
        label: "Trucks available", value: available, href: to("/fleet?status=ACTIVE"), icon: Truck, tone: "hue-1",
        sub: noDriver || held
          ? <Flag tone="warn">{[noDriver ? `${noDriver} without a driver` : null, held ? `${held} driver${held === 1 ? "" : "s"} on hold` : null].filter(Boolean).join(" · ")}</Flag>
          : `Active, with a driver who is cleared to drive · ${fleet.length} in the fleet`,
        alert: noDriver + held > 0,
      },
      {
        label: "In shop", value: status.shop, href: to("/maintenance?tab=shop"), icon: Wrench, tone: "hue-4",
        sub: outOfService ? <Flag tone="danger">{outOfService} out of service</Flag> : status.shop ? "In maintenance or with a job in progress" : "Every truck is out of the shop",
        alert: outOfService > 0,
      },
      {
        label: "PM due", value: pmOverdue + pmDue, href: to("/maintenance?tab=pm"), icon: Gauge, tone: "hue-3",
        sub: pmOverdue ? <><Flag tone="danger">{pmOverdue} overdue</Flag>{pmDue ? ` · ${pmDue} due soon` : ""}</> : "Within 2,000 km of the next service, or past it",
        alert: pmOverdue > 0,
      },
      {
        label: "Paperwork due", value: unitPapers.length, href: to("/maintenance?tab=compliance"), icon: FileClock, tone: "hue-2",
        sub: paperworkLine(unitExpired, unitPapers.length - unitExpired), alert: unitExpired > 0,
      },
      {
        label: "Driver papers", value: driversAffected, href: to("/dashboard/alerts?kind=drivers"), icon: IdCard, tone: "hue-5",
        sub: driversExpired
          ? <><Flag tone="danger">{plural(driversExpired, "driver")} expired</Flag>{driversAffected > driversExpired ? ` · ${driversAffected - driversExpired} expiring` : ""}</>
          : driversAffected ? "Drivers with a licence, medical or document expiring within 30 days" : "Every driver's papers are valid for 30+ days",
        alert: driversExpired > 0,
      },
      {
        label: "Open work orders", value: work.open, href: to("/maintenance/work-orders"), icon: ClipboardList, tone: "hue-6",
        sub: work.overdue ? <Flag tone="danger">{work.overdue} past the booked day</Flag> : "Drafts, booked and in progress",
        alert: work.overdue > 0,
      },
    ];
  }

  /* ---------- Costs ---------- */
  let costCard: ReactNode = null;
  if (costs) {
    const cur = costs.months.at(-1)!;
    const prev = costs.months.at(-2)!;
    const perKm = costs.kmThisMonth ? cur.total / costs.kmThisMonth : null;
    const prevPerKm = costs.kmLastMonth ? prev.total / costs.kmLastMonth : null;
    const perKmDelta = perKm != null && prevPerKm ? Math.round(((perKm - prevPerKm) / prevPerKm) * 100) : null;
    const anything = costs.months.some((m) => m.total > 0);
    const metrics: Metric[] = [
      { label: `Maintenance · ${cur.month}`, value: money(cur.maintenance), note: `${prev.month} ${money(prev.maintenance)}`, href: to("/maintenance") },
      { label: `Fuel · ${cur.month}`, value: money(cur.fuel), note: `${prev.month} ${money(prev.fuel)}`, href: to("/reports") },
      { label: `Distance · ${cur.month}`, value: costs.kmThisMonth ? km(costs.kmThisMonth) : "—", note: costs.kmLastMonth ? `${prev.month} ${km(costs.kmLastMonth)}` : undefined, href: to("/reports") },
      {
        label: `Cost per km · ${cur.month}`, value: perKm != null ? money2(perKm) : "—", href: to("/reports"),
        // Lower is better: a rise is red, a drop green.
        note: perKmDelta ? `${pct(perKmDelta)} vs ${prev.month}` : undefined, noteTone: perKmDelta ? (perKmDelta > 0 ? "danger" : "ok") : undefined,
      },
    ];
    costCard = (
      <Card bodyClassName="grid gap-6 px-4 pb-4 pt-2 lg:grid-cols-3"
        title={<span className="flex items-center gap-1.5">Costs<InfoTip>Maintenance is completed work orders by completion date; fuel is every fill by date. Cost per km divides both by the kilometres driven, from odometer readings. This month runs to today.</InfoTip></span>}
        actions={<><span className="num hidden rounded-full bg-neutral-soft px-2 text-[11px] leading-5 text-fg-muted sm:inline">{costs.months[0].month} – {cur.month}</span>{to("/reports") && <MoreLink href="/reports">Reports</MoreLink>}</>}>
        <div className="min-w-0 lg:col-span-2">
          {anything
            ? <SimpleBar data={costs.months.map((m) => ({ month: m.month, spend: Math.round(m.total) }))} dataKey="spend" nameKey="month" money tone="accent" height={220} />
            : <ChartEmpty height={220} title="No costs yet" hint="Spend appears here once work orders are completed with a cost or fuel fills are logged." />}
        </div>
        <MetricList items={metrics} className="self-start" />
      </Card>
    );
  }

  /* ---------- Cards ---------- */
  const today = shop && (
    <Card flush title="Today in the shop" actions={<MoreLink href="/maintenance/work-orders">Work orders</MoreLink>}>
      <div className="border-t border-line"><ShopToday day={shop} now={now} canEdit={canEdit} /></div>
    </Card>
  );
  const map = show("fleet") && fleet && (
    <Card title="Live fleet" bodyClassName="p-1.5 pt-1" actions={seesTracking ? <MoreLink href="/tracking">Live map</MoreLink> : undefined}>
      {fleet.length
        ? <LiveFleetMini initial={fleet} at={now.toISOString()} height={320} live={seesTracking} />
        : <EmptyState title="No trucks in service" description="Trucks that are active, in the shop or out of service appear on the map." action={canEdit ? <LinkButton href="/fleet/new" variant="secondary" size="sm">Add a truck</LinkButton> : undefined} />}
    </Card>
  );
  const attention = show("attention") && <NeedsAttention alerts={alerts} groups={groupAlerts(alerts)} />;
  const upcoming = show("upcoming") && papers && (
    <Card flush title={<span className="flex items-center gap-1.5">Coming up<InfoTip>Paperwork expiring in the next 30 days and trucks within 2,000 km of their PM. Anything already expired or overdue is under Needs attention.</InfoTip></span>}
      actions={<span className="num rounded-full bg-neutral-soft px-2 text-[11px] leading-5 text-fg-muted">Next 30 days</span>}>
      <div className="border-t border-line">
        <ComingUp
          papers={papers.filter((p) => !p.expired)}
          pm={pmSoon.map((t): PmDue => ({ id: t.id, unitNumber: t.unitNumber, leftKm: t.pm.leftKm!, booked: pmBooked?.get(t.id) ?? null }))}
          now={now} role={user.role} canEdit={canEdit} />
      </div>
    </Card>
  );
  const hasMain = Boolean(today || map);
  const hasAside = Boolean(attention || upcoming);
  // Trucks but no drivers (or the other way round) is still setting up; a view-only member can't help, so it stays quiet for them.
  const setupLeft = welcome || ((setup.trucks === 0 || setup.drivers === 0) && (canEdit || can(user.role, "drivers.edit")));
  const nothing = !kpis.length && !hasMain && !hasAside && !costCard;

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${firstName}`}
        subtitle={summary}
        actions={<><CustomizeOverview hidden={[...hidden]} />{canEdit && <LinkButton href="/maintenance/work-orders/new"><Plus />New work order</LinkButton>}</>}
      />

      <div className="space-y-4">
        {setupLeft && <SetupChecklist company={user.company.name} progress={setup} role={user.role} fresh={false} />}

        {kpis.length > 0 && <KpiStrip items={kpis} />}

        {/* Two columns that flow independently: the shop and the fleet on the left, what to act on on the right
            (first on a phone, where it stacks). */}
        {(hasMain || hasAside) && (
          <div className={cn("grid items-start gap-4", hasMain && hasAside && "xl:grid-cols-3")}>
            {hasMain && <div className={cn("grid min-w-0 gap-4", hasAside && "xl:col-span-2")}>{today}{map}</div>}
            {hasAside && <div className={cn("order-first grid min-w-0 gap-4 xl:order-none", !hasMain && "md:grid-cols-2")}>{attention}{upcoming}</div>}
          </div>
        )}

        {costCard}

        {nothing && (
          <Card>
            <EmptyState title="Your overview is empty" description="Every section is hidden. Use Customize to bring back the ones you want." />
          </Card>
        )}
      </div>
    </>
  );
}
