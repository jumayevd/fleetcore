import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileWarning, PauseCircle, Plus, ShieldAlert, Truck as TruckIcon, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { DRIVER_STATUSES, DRIVER_TYPES, DRIVER_TYPE_LABELS, DRIVER_TYPE_SHORT, humanize } from "@/lib/constants";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS } from "@/lib/documents";
import { daysUntil, number } from "@/lib/format";
import { Avatar, Badge, Card, Chip, EmptyState, ExpiryBadge, InfoTip, LinkButton, PageHeader, Stat, Table, cn } from "@/components/ui";
import { DriverFilters } from "./filters";
import { LinkRow } from "./link-row";
import { dispatcherOptions } from "./data";
import {
  AT_RISK_SCORE, DRIVER_TYPE_TONE, EMPLOYMENT_LABELS, atRiskWhere, clearance, clearedWhere, expiredWhere, expiringWhere, riskReasons, scoreGrade,
} from "./shared";

export const metadata = { title: "Drivers" };

/** Rows rendered at most; the footer says when a filter matches more. */
const LIMIT = 200;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneOf = (list: readonly string[], v: string | undefined) => (v && list.includes(v) ? v : undefined);
const flag = (v: string | string[] | undefined) => (str(v) === "1" ? "1" : undefined);

export default async function DriversPage({ searchParams }: PageProps<"/drivers">) {
  const user = await requireUser("drivers.view");
  const editable = can(user.role, "drivers.edit");
  const sp = await searchParams;
  const params = {
    q: str(sp.q),
    type: oneOf(DRIVER_TYPES, str(sp.type)),
    status: oneOf(DRIVER_STATUSES, str(sp.status)),
    inactive: flag(sp.inactive),
    // `atRisk=1` is the filter's name; `risk=1` still works for links made before the rename.
    atRisk: flag(sp.atRisk) ?? flag(sp.risk),
    papers: flag(sp.papers),
    hold: flag(sp.hold),
    truck: str(sp.truck) === "none" ? "none" : undefined,
    dispatcher: str(sp.dispatcher),
  };

  // Filtering happens in the database; only the rows on screen are loaded.
  const now = new Date().getTime();
  const working: Prisma.DriverWhereInput = { status: { not: "INACTIVE" } };
  const text = { contains: params.q ?? "", mode: "insensitive" as const };
  const where: Prisma.DriverWhereInput = {
    AND: [
      params.status ? { status: params.status } : params.inactive ? {} : working,
      params.type ? { type: params.type } : {},
      params.hold ? { hold: true } : {},
      params.atRisk ? atRiskWhere(now) : {},
      params.papers ? expiringWhere(now) : {},
      params.truck ? { truck: { is: null } } : {},
      params.dispatcher === "none" ? { dispatcher: null } : params.dispatcher ? { dispatcher: params.dispatcher } : {},
      params.q ? {
        OR: [
          { name: text }, { phone: text }, { phone2: text }, { email: text }, { licenseNumber: text }, { dispatcher: text },
          { truck: { is: { unitNumber: text } } }, { truck: { is: { plate: text } } },
        ],
      } : {},
    ],
  };

  const [drivers, matched, byState, cleared, noTruck, papersDue, papersExpired, risky, dispatchers] = await Promise.all([
    db.driver.findMany({
      where, orderBy: { name: "asc" }, take: LIMIT,
      include: { truck: { select: { id: true, unitNumber: true, make: true, model: true, status: true } } },
    }),
    db.driver.count({ where }),
    // Roster KPIs are fleet-wide (not affected by the filters).
    db.driver.groupBy({ by: ["status", "hold"], _count: true }),
    db.driver.count({ where: clearedWhere(now) }),
    db.driver.count({ where: { status: "ACTIVE", truck: { is: null } } }),
    db.driver.count({ where: { AND: [working, expiringWhere(now)] } }),
    db.driver.count({ where: { AND: [working, expiredWhere(now)] } }),
    db.driver.count({ where: { AND: [working, atRiskWhere(now)] } }),
    dispatcherOptions(),
  ]);

  const tally = (keep: (g: (typeof byState)[number]) => boolean) => byState.reduce((a, g) => a + (keep(g) ? g._count : 0), 0);
  const total = tally(() => true);
  const activeCount = tally((g) => g.status === "ACTIVE");
  const onLeave = tally((g) => g.status === "ON_LEAVE");
  const inactiveCount = tally((g) => g.status === "INACTIVE");
  const holds = tally((g) => g.status !== "INACTIVE" && g.hold);

  const header = (
    <PageHeader
      title="Drivers"
      subtitle={total > 0
        ? <><span className="num">{cleared}</span> of <span className="num">{activeCount}</span> active drivers cleared to drive</>
        : "Who drives which truck, and whether their papers are in date"}
      actions={editable && <LinkButton href="/drivers/new"><Plus />Add driver</LinkButton>}
    />
  );

  // A brand-new company: one clear next step instead of empty tiles and an empty table.
  if (total === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={<Users />} title={editable ? "Add your first driver" : "No drivers yet"}
            description={editable
              ? "Add a driver with their licence and medical certificate dates, then give them a truck. You'll see renewals coming 30 days ahead."
              : "Someone with edit rights in this company can add drivers."}
            action={editable && <LinkButton href="/drivers/new"><Plus />Add driver</LinkButton>} />
        </Card>
      </>
    );
  }

  // Required scans (licence, medical) on file, for the drivers on screen.
  const scans = await db.document.findMany({
    where: { driverId: { in: drivers.map((d) => d.id) }, kind: { in: [...REQUIRED_DRIVER_DOCS] } },
    distinct: ["driverId", "kind"], select: { driverId: true, kind: true },
  });
  const scansFor = new Map<string, Set<string>>();
  for (const s of scans) if (s.driverId) scansFor.set(s.driverId, (scansFor.get(s.driverId) ?? new Set()).add(s.kind));

  const filtered = Object.values(params).some(Boolean);
  const only = (p: Record<string, string>) => `/drivers?${new URLSearchParams(p)}`;
  // A KPI tile opens the roster filtered to exactly what it counts; it reads as selected while that filter is on.
  const tile = (href: string, on: boolean, node: React.ReactNode) => (
    <Link href={on ? "/drivers" : href} aria-current={on || undefined} title={on ? "Show all drivers" : undefined}
      className={cn("group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", on && "ring-2 ring-accent/40")}>
      {node}
    </Link>
  );
  const tileClass = "h-full transition-[border-color,box-shadow] group-hover:border-line-strong group-hover:shadow-lift";
  const is = (want: Partial<typeof params>) =>
    Object.entries(params).every(([k, v]) => (want[k as keyof typeof params] ?? undefined) === v);

  return (
    <>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tile(only({ status: "ACTIVE" }), is({ status: "ACTIVE" }),
          <Stat className={tileClass} label="Active drivers" value={activeCount} icon={<Users />}
            hint={`${onLeave} on leave · ${inactiveCount} inactive`} />)}
        {tile(only({ status: "ACTIVE", truck: "none" }), is({ status: "ACTIVE", truck: "none" }),
          <Stat className={tileClass} label="Without a truck" value={noTruck} icon={<TruckIcon />} tone={noTruck ? "warn" : "neutral"}
            hint={noTruck ? "active drivers with no truck assigned" : "every active driver has a truck"} />)}
        {tile(only({ hold: "1" }), is({ hold: "1" }),
          <Stat className={tileClass} label="On hold" value={holds} icon={<PauseCircle />} tone={holds ? "warn" : "neutral"}
            hint={holds ? "not cleared to drive until released" : "nobody is held back"} />)}
        {tile(only({ papers: "1" }), is({ papers: "1" }),
          <Stat className={tileClass} label="Papers due in 30d" value={papersDue} icon={<FileWarning />}
            tone={papersExpired ? "danger" : papersDue ? "warn" : "ok"}
            hint={papersExpired ? `${papersExpired} already expired` : papersDue ? "licence or medical renewals coming up" : "all licences and medicals in date"} />)}
        {tile(only({ atRisk: "1" }), is({ atRisk: "1" }),
          <Stat className={tileClass} label="At risk" value={risky} icon={<ShieldAlert />} tone={risky ? "danger" : "ok"}
            hint={risky ? `score under ${AT_RISK_SCORE} or papers due` : "scores and papers are fine"} />)}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DriverFilters params={params} dispatchers={dispatchers}
          types={DRIVER_TYPES.map((t) => ({ value: t, label: DRIVER_TYPE_LABELS[t] }))}
          statuses={DRIVER_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_LABELS[s] }))} />
        <p className="num text-[12px] text-fg-subtle">
          {matched > drivers.length ? <>First {drivers.length} of {number(matched)}</> : filtered ? <>{drivers.length} of {number(total)}</> : <>{number(drivers.length)} drivers</>}
        </p>
      </div>

      <Card flush>
        <Table head={[
          "Driver",
          <span key="clear" className="inline-flex items-center gap-1">Cleared to drive<InfoTip>Cleared: active, not on hold, and licence and medical certificate in date.</InfoTip></span>,
          "Truck",
          <span key="dispatch" className="inline-flex items-center gap-1">Dispatcher<InfoTip>Who dispatches the driver. Walk-around videos and repairs are chased through them.</InfoTip></span>,
          <span key="score" className="inline-flex items-center gap-1">Safety<InfoTip>Grade A from 90 · B from 80 · C from 70 · D below. At risk: score under {AT_RISK_SCORE}, or licence or medical expired or expiring within 30 days.</InfoTip></span>,
          "Licence", "Medical",
          <span key="scans" className="inline-flex items-center gap-1">Scans<InfoTip>Licence and medical certificate scans on file. Upload them on the driver&apos;s Documents tab.</InfoTip></span>,
          "Phone",
        ]}>
          {drivers.map((d) => {
            const g = scoreGrade(d.score);
            const risks = riskReasons(d);
            const c = clearance(d);
            const have = scansFor.get(d.id);
            const missing = REQUIRED_DRIVER_DOCS.filter((k) => !have?.has(k));
            return (
              <LinkRow key={d.id} href={`/drivers/${d.id}`} className={d.status === "INACTIVE" ? "opacity-60" : undefined}>
                <td className="min-w-52">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={d.name} size={28} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/drivers/${d.id}`} className="truncate font-medium text-fg hover:underline">{d.name}</Link>
                        <Chip tone={DRIVER_TYPE_TONE[d.type]} title={DRIVER_TYPE_LABELS[d.type]}>{DRIVER_TYPE_SHORT[d.type] ?? d.type}</Chip>
                      </div>
                      <p className="num truncate text-[11px] text-fg-subtle">{d.licenseNumber} · {d.licenseClass}</p>
                    </div>
                  </div>
                </td>
                <td className="max-w-56">
                  <Badge value={c.label} label={c.label} tone={c.tone} dot />
                  {c.detail && <p className="mt-0.5 truncate text-[11px] text-fg-subtle" title={c.reasons.join(" · ")}>{c.detail}</p>}
                </td>
                <td>
                  {d.truck ? (
                    <div className="min-w-0">
                      <Link href={`/fleet/${d.truck.id}`} className="num unit-no font-medium text-fg hover:underline">{d.truck.unitNumber}</Link>
                      <p className="truncate text-[11px] text-fg-subtle">{d.truck.make} {d.truck.model}{d.truck.status !== "ACTIVE" && <> · <span className="text-warn">{humanize(d.truck.status).toLowerCase()}</span></>}</p>
                    </div>
                  ) : d.status === "ACTIVE" && editable && can(user.role, "fleet.edit") ? (
                    <Link href={`/drivers/${d.id}#truck`} className="text-[12px] font-medium text-accent-text hover:underline">Assign truck</Link>
                  ) : <span className="text-fg-faint">—</span>}
                </td>
                <td className="max-w-40 truncate">
                  {d.dispatcher
                    ? <Link href={`/drivers?dispatcher=${encodeURIComponent(d.dispatcher)}`} className="text-fg-muted hover:text-fg hover:underline" title={`Drivers dispatched by ${d.dispatcher}`}>{d.dispatcher}</Link>
                    : editable ? <Link href={`/drivers/${d.id}/edit`} className="text-[12px] text-fg-subtle hover:text-fg hover:underline">Set</Link> : <span className="text-fg-faint">—</span>}
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge value={g.grade} tone={g.tone} label={`${g.grade} · ${d.score}`} className="num" />
                    {risks.length > 0 && (
                      <span title={risks.map((r) => r.text).join(" · ")} className="inline-flex">
                        <ShieldAlert className="h-3.5 w-3.5 text-danger" aria-label={`At risk: ${risks.map((r) => r.text).join(", ")}`} />
                      </span>
                    )}
                  </span>
                </td>
                <td><ExpiryBadge days={daysUntil(d.licenseExpiry)} /></td>
                <td>{d.medicalExpiry ? <ExpiryBadge days={daysUntil(d.medicalExpiry)} /> : <span className="text-[12px] text-warn" title="No medical certificate expiry recorded">Not recorded</span>}</td>
                <td>
                  <span className={cn("num text-[12px]", missing.length ? "text-warn" : "text-ok")}
                    title={missing.length ? `Missing: ${missing.map((k) => DOC_KIND_LABELS[k].toLowerCase()).join(", ")}` : "All required scans on file"}>
                    {REQUIRED_DRIVER_DOCS.length - missing.length}/{REQUIRED_DRIVER_DOCS.length}
                  </span>
                </td>
                <td>
                  {d.phone ? <a href={`tel:${d.phone}`} title={d.phone2 ? `Second number: ${d.phone2}` : undefined} className="num whitespace-nowrap hover:underline">{d.phone}</a> : <span className="text-fg-faint">—</span>}
                </td>
              </LinkRow>
            );
          })}
        </Table>
        {drivers.length === 0 && (
          <EmptyState title="No drivers match these filters" description="Try another filter or search, or show everyone again."
            action={<LinkButton href="/drivers" variant="secondary">Clear filters</LinkButton>} />
        )}
        {matched > drivers.length && (
          <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">
            Showing the first <span className="num">{drivers.length}</span> of <span className="num">{number(matched)}</span> by name. Search or filter to find the rest.
          </p>
        )}
      </Card>
    </>
  );
}
