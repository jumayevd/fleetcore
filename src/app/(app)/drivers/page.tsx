import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Users, CheckCircle2, Route, PauseCircle, ShieldAlert, PackageCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BOARD_STATUS_LABELS, DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS, DRIVER_TYPE_SHORT, type BoardStatus } from "@/lib/constants";
import { daysAgo, daysUntil, money, number } from "@/lib/format";
import { Avatar, Badge, Card, Chip, EmptyState, ExpiryBadge, InfoTip, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { DriverFilters } from "./filters";
import { LinkRow } from "./link-row";
import { TeamControl } from "./team-control";
import { ACTIVE_LOAD_STATUSES, COMPLETED_LOAD_STATUSES, DRIVER_TYPE_TONE, EMPLOYMENT_LABELS, ON_TRIP_STATUSES, atRisk, atRiskWhere, expiringWhere, scoreGrade, sinceShort } from "./shared";

export const metadata = { title: "Drivers" };

/** Rows rendered at most; the footer says when a filter matches more. */
const LIMIT = 200;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneOf = (list: readonly string[], v: string | undefined) => (v && list.includes(v) ? v : undefined);

export default async function DriversPage({ searchParams }: PageProps<"/drivers">) {
  const user = await requireUser("drivers.view");
  const editable = can(user.role, "drivers.edit");
  const sp = await searchParams;
  const team = str(sp.team);
  const type = oneOf(DRIVER_TYPES, str(sp.type));
  const status = oneOf(DRIVER_STATUSES, str(sp.status));
  // `atRisk=1` is the filter's name; `risk=1` still works for links made before the rename.
  const risk = str(sp.atRisk) === "1" || str(sp.risk) === "1" ? "1" : undefined;
  const inactive = str(sp.inactive) === "1" ? "1" : undefined;
  const hold = str(sp.hold) === "1" ? "1" : undefined;
  const q = str(sp.q);
  const params = { team, type, status, atRisk: risk, inactive, hold, q };

  // Filtering happens in the database; only the rows on screen are loaded.
  const now = new Date().getTime();
  const working: Prisma.DriverWhereInput = { status: { not: "INACTIVE" } };
  const text = { contains: q ?? "", mode: "insensitive" as const };
  const where: Prisma.DriverWhereInput = {
    AND: [
      status ? { status } : inactive ? {} : working,
      team === "none" ? { teamId: null } : team ? { teamId: team } : {},
      type ? { type } : {},
      hold ? { hold: true } : {},
      risk ? atRiskWhere(now) : {},
      q ? {
        OR: [
          { name: text }, { phone: text }, { phone2: text }, { email: text }, { licenseNumber: text },
          { truck: { is: { unitNumber: text } } }, { team: { is: { name: text } } },
        ],
      } : {},
    ],
  };
  const completed = { status: { in: [...COMPLETED_LOAD_STATUSES] }, driverId: { not: null } };
  const since30 = daysAgo(30);

  const [drivers, matched, teams, byState, risky, expiring, noLogin, loadsAllTime, loads30] = await Promise.all([
    db.driver.findMany({
      where, orderBy: { name: "asc" }, take: LIMIT,
      include: {
        team: { select: { id: true, name: true, color: true } }, truck: { select: { id: true, unitNumber: true } }, user: { select: { id: true, active: true } },
        _count: { select: { loads: { where: { status: { in: [...COMPLETED_LOAD_STATUSES] } } } } },
      },
    }),
    db.driver.count({ where }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
    // Roster KPIs are fleet-wide (not affected by the filters).
    db.driver.groupBy({ by: ["status", "boardStatus", "hold"], _count: true }),
    db.driver.count({ where: { AND: [working, atRiskWhere(now)] } }),
    db.driver.count({ where: { AND: [working, expiringWhere(now)] } }),
    db.driver.count({ where: { AND: [working, { userId: null }] } }),
    db.load.count({ where: completed }),
    db.load.aggregate({ where: { ...completed, deliveredAt: { gte: since30 } }, _sum: { rate: true }, _count: true }),
  ]);

  // 30-day figures and current loads, for the drivers on screen only.
  const ids = drivers.map((d) => d.id);
  const [recent, activeLoads] = await Promise.all([
    db.load.groupBy({
      by: ["driverId"],
      where: { driverId: { in: ids }, status: { in: [...COMPLETED_LOAD_STATUSES] }, deliveredAt: { gte: since30 } },
      _sum: { distanceKm: true, rate: true }, _count: true,
    }),
    db.load.findMany({
      // In transit first ("IN_TRANSIT" sorts after "ASSIGNED"), then the next pickup among prebooked loads.
      where: { driverId: { in: ids }, status: { in: [...ACTIVE_LOAD_STATUSES] } }, orderBy: [{ status: "desc" }, { pickupAt: "asc" }],
      select: { id: true, reference: true, driverId: true, destCity: true },
    }),
  ]);
  const recentFor = new Map(recent.map((r) => [r.driverId, r]));
  const loadFor = new Map<string, (typeof activeLoads)[number]>();
  for (const l of activeLoads) if (l.driverId && !loadFor.has(l.driverId)) loadFor.set(l.driverId, l);

  const tally = (keep: (g: (typeof byState)[number]) => boolean) => byState.reduce((a, g) => a + (keep(g) ? g._count : 0), 0);
  const total = tally(() => true);
  const activeCount = tally((g) => g.status === "ACTIVE");
  const onLeave = tally((g) => g.status === "ON_LEAVE");
  const inactiveCount = tally((g) => g.status === "INACTIVE");
  const ready = tally((g) => g.status === "ACTIVE" && g.boardStatus === "READY" && !g.hold);
  const onTrips = tally((g) => g.status !== "INACTIVE" && (ON_TRIP_STATUSES as readonly string[]).includes(g.boardStatus));
  const enRoute = tally((g) => g.status !== "INACTIVE" && g.boardStatus === "EN_ROUTE");
  const holds = tally((g) => g.status !== "INACTIVE" && g.hold);
  const avgLoad30 = loads30._count ? (loads30._sum.rate ?? 0) / loads30._count : null;

  const qs = (patch: Partial<typeof params>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/drivers${s ? `?${s}` : ""}`;
  };
  const filtered = Object.values(params).some(Boolean);
  const tile = (href: string | null, node: React.ReactNode) =>
    href ? <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link> : node;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";

  return (
    <>
      <PageHeader
        eyebrow="People & partners"
        title="Drivers"
        actions={editable && <LinkButton href="/drivers/new"><Plus />Add driver</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile(filtered ? "/drivers" : qs({ status: "ACTIVE" }), <Stat className={tileClass} label="Active drivers" value={activeCount} hint={`${onLeave} on leave · ${inactiveCount} inactive`} icon={<Users />} />)}
        <Stat className={tileClass} label="Ready" value={ready} hint="available for dispatch" tone={ready ? "ok" : "neutral"} icon={<CheckCircle2 />} />
        <Stat className={tileClass} label="On trips" value={onTrips} hint={`${enRoute} en route · ${onTrips - enRoute} dispatched or at a stop`} tone="progress" icon={<Route />} />
        {tile(qs({ hold: "1", status: undefined }), <Stat className={tileClass} label="On hold" value={holds} hint={holds ? "excluded from dispatch" : "nobody is held back"} tone={holds ? "warn" : "neutral"} icon={<PauseCircle />} />)}
        {tile(qs({ atRisk: "1", status: undefined }), <Stat className={tileClass} label="At risk" value={risky} hint={risky ? `${expiring} with papers expiring within 30d` : "scores and papers are fine"} tone={risky ? "danger" : "ok"} icon={<ShieldAlert />} />)}
        <Stat className={tileClass} label="Total loads" value={number(loadsAllTime)} icon={<PackageCheck />}
          hint={loads30._count ? `${number(loads30._count)} in 30d · ${money(avgLoad30)}/load` : "none delivered in 30d"} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DriverFilters params={params}
          teams={teams.map((t) => ({ value: t.id, label: t.name }))}
          types={DRIVER_TYPES.map((t) => ({ value: t, label: DRIVER_TYPE_LABELS[t] }))}
          statuses={DRIVER_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_LABELS[s] }))} />
        <p className="num text-[12px] text-fg-subtle">
          {matched > drivers.length ? <>First {drivers.length} of {number(matched)}</> : <>{drivers.length} of {number(total)}</>}
        </p>
      </div>

      <Card flush>
        <Table head={[
          "Driver",
          <span key="score" className="inline-flex items-center gap-1">Score<InfoTip>A from 90 · B from 80 · C from 70 · D below. At risk: score under 75, or licence or medical expired or expiring within 30 days.</InfoTip></span>,
          "Status", "Team", "Truck", "Phone",
          <span key="30d" className="inline-flex items-center gap-1">30d loads<InfoTip>Delivered loads in the last 30 days, by delivery date. Hover a number for the all-time count.</InfoTip></span>,
          "30d km", "30d revenue", "30d avg/load", "Licence", "Medical", "App login",
        ]}>
          {drivers.map((d) => {
            const r = recentFor.get(d.id);
            const l = loadFor.get(d.id);
            const g = scoreGrade(d.score);
            const risks = atRisk(d);
            return (
              <LinkRow key={d.id} href={`/drivers/${d.id}`}>
                <td className="min-w-52">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={d.name} size={28} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/drivers/${d.id}`} className="truncate font-medium text-fg hover:underline" title={d.email ?? undefined}>{d.name}</Link>
                        <Chip tone={DRIVER_TYPE_TONE[d.type]} title={DRIVER_TYPE_LABELS[d.type]}>{DRIVER_TYPE_SHORT[d.type] ?? d.type}</Chip>
                        {d.hold && <Chip tone="warn" title={d.holdReason ?? "On hold"}>Hold</Chip>}
                      </div>
                      {d.status !== "ACTIVE" && <Badge value={d.status} label={EMPLOYMENT_LABELS[d.status] ?? d.status} className="mt-0.5" />}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge value={g.grade} tone={g.tone} label={`${g.grade} · ${d.score}`} className="num" />
                    {risks && <ShieldAlert className="h-3.5 w-3.5 text-danger" aria-label="At risk" />}
                  </span>
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <Badge value={d.boardStatus} label={BOARD_STATUS_LABELS[d.boardStatus as BoardStatus] ?? d.boardStatus} dot />
                    <span className="num text-[11px] text-fg-subtle" title="Time in this status">{sinceShort(d.boardStatusSince)}</span>
                  </div>
                  {l && <div className="mt-0.5 text-[11px] text-fg-subtle"><Link href={`/loads/${l.id}`} className="num hover:underline" title={`To ${l.destCity}`}>{l.reference}</Link></div>}
                </td>
                <td><TeamControl driverId={d.id} teamId={d.teamId} teams={teams} editable={editable} /></td>
                <td>{d.truck ? <Link href={`/fleet/${d.truck.id}`} className="num hover:underline">{d.truck.unitNumber}</Link> : <span className="text-fg-faint">—</span>}</td>
                <td>
                  {d.phone ? <a href={`tel:${d.phone}`} title={d.phone2 ? `Second number: ${d.phone2}` : undefined} className="num whitespace-nowrap hover:underline">{d.phone}</a> : <span className="text-fg-faint">—</span>}
                </td>
                <td className="num" title={`${number(d._count.loads)} all time`}>{r?._count ?? 0}</td>
                <td className="num text-fg-muted">{number(r?._sum.distanceKm)}</td>
                <td className="num">{r ? money(r._sum.rate) : <span className="text-fg-faint">—</span>}</td>
                <td className="num text-fg-muted">{r?._count ? money((r._sum.rate ?? 0) / r._count) : <span className="text-fg-faint">—</span>}</td>
                <td><ExpiryBadge days={daysUntil(d.licenseExpiry)} /></td>
                <td><ExpiryBadge days={daysUntil(d.medicalExpiry)} /></td>
                <td>{d.user ? <Badge value={d.user.active ? "ACTIVE" : "INACTIVE"} label={d.user.active ? "Enabled" : "Deactivated"} /> : <span className="text-fg-faint">—</span>}</td>
              </LinkRow>
            );
          })}
        </Table>
        {drivers.length === 0 && (
          total === 0
            ? <EmptyState title="No drivers yet" description="Add your first driver to start dispatching loads." action={editable && <LinkButton href="/drivers/new"><Plus />Add driver</LinkButton>} />
            : <EmptyState title="No drivers match" description="Try another team, type or status, or clear the search." action={<LinkButton href="/drivers" variant="secondary">Clear filters</LinkButton>} />
        )}
        {matched > drivers.length && (
          <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">
            Showing the first <span className="num">{drivers.length}</span> of <span className="num">{number(matched)}</span> by name. Search or filter by team, type or status to find the rest.
          </p>
        )}
      </Card>
      {noLogin > 0 && <p className="mt-2 text-[12px] text-fg-subtle"><span className="num">{noLogin}</span> drivers have no app login yet.</p>}
    </>
  );
}
