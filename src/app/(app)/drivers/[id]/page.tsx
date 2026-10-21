import Link from "next/link";
import { notFound } from "next/navigation";
import { addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronRight, Pencil, Phone, Mail, Star, Smartphone, Truck as TruckIcon } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BOARD_STATUS_LABELS, DRIVER_TYPE_LABELS, LOAD_STATUS_LABELS, type BoardStatus, type LoadStatus } from "@/lib/constants";
import { DOC_KIND_LABELS, REQUIRED_DRIVER_DOCS } from "@/lib/documents";
import { ago, date, dateTime, daysAgo, daysUntil, km, money, money2, number } from "@/lib/format";
import { estimatedArrival, loadProgress } from "@/lib/telemetry";
import { DocumentsPanel } from "@/components/documents/panel";
import { Spark } from "@/components/charts-lite";
import { Badge, Card, Cell, Chip, DL, EmptyState, ExpiryBadge, InfoTip, LinkButton, PageHeader, Progress, STATUS_TONE, Stat, StatusDot, TONE_DOT, Table, Tabs, cn, type Tone } from "@/components/ui";
import { TeamDot } from "../team-control";
import { HoldControl } from "./hold-control";
import { EmploymentMenu } from "./employment-menu";
import {
  ACTIVE_LOAD_STATUSES, COMPLETED_LOAD_STATUSES, DRIVER_TYPE_TONE, EMPLOYMENT_LABELS, fmtDuration, onTimeTone, perfFromTotals, performance, riskReasons, scoreGrade, sinceShort, tenure,
} from "../shared";

const TABS = ["overview", "performance", "documents", "loads", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", performance: "Performance", documents: "Documents", loads: "Loads", history: "History" };
const DOC_FIELD: Record<string, "licenseExpiry" | "medicalExpiry"> = { LICENSE: "licenseExpiry", MEDICAL: "medicalExpiry" };
const IDLE_DAYS = 2;
const WEEKS = 8;

export async function generateMetadata({ params }: PageProps<"/drivers/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.driver.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: r?.name ?? "Not found" };
}

export default async function DriverDetail({ params, searchParams }: PageProps<"/drivers/[id]">) {
  const user = await requireUser("drivers.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  const editable = can(user.role, "drivers.edit");
  const showEarnings = can(user.role, "finance.view") || editable;

  const driver = await db.driver.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true, color: true } },
      truck: { select: { id: true, unitNumber: true, make: true, model: true, year: true, plate: true, status: true, locationName: true, lastPingAt: true } },
      user: { select: { id: true, email: true, lastLoginAt: true, active: true } },
      _count: { select: { loads: true, statusEvents: true } },
    },
  });
  if (!driver) notFound();

  // Lifetime figures come from aggregates; only the last 90 days of loads are fetched, for the recent and weekly breakdowns.
  const completed = { driverId: id, status: { in: [...COMPLETED_LOAD_STATUSES] } };
  const since90 = daysAgo(90);
  const [totals, onTimeAll, recentLoads, active, docRows] = await Promise.all([
    db.load.aggregate({ where: completed, _sum: { rate: true, driverPay: true, distanceKm: true, emptyKm: true }, _count: true }),
    db.load.count({ where: { ...completed, deliveredAt: { lte: db.load.fields.deliveryAt } } }),
    db.load.findMany({
      where: { ...completed, deliveredAt: { gte: since90 } },
      select: { rate: true, driverPay: true, distanceKm: true, emptyKm: true, deliveredAt: true, deliveryAt: true },
    }),
    db.load.findFirst({
      where: { driverId: id, status: { in: [...ACTIVE_LOAD_STATUSES] } }, orderBy: [{ status: "desc" }, { pickupAt: "asc" }],
      select: { id: true, reference: true, status: true, originCity: true, destCity: true, pickupAt: true, deliveryAt: true, departedAt: true, distanceKm: true, customer: { select: { name: true } } },
    }),
    db.document.findMany({ where: { driverId: id, kind: { in: [...REQUIRED_DRIVER_DOCS] } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, expiresAt: true } }),
  ]);
  const have = new Set(docRows.map((d) => d.kind));
  const missingDocs = REQUIRED_DRIVER_DOCS.filter((k) => !have.has(k));
  const lifetime = perfFromTotals({
    loads: totals._count, km: totals._sum.distanceKm ?? 0, emptyKm: totals._sum.emptyKm ?? 0,
    revenue: totals._sum.rate ?? 0, pay: totals._sum.driverPay ?? 0, onTime: onTimeAll,
  });
  const recent = performance(recentLoads);
  const grade = scoreGrade(driver.score);
  const risks = riskReasons(driver);
  const idleDays = driver.status === "ACTIVE" && driver.boardStatus === "READY" && !active ? Math.floor((new Date().getTime() - driver.boardStatusSince.getTime()) / 86_400_000) : 0;

  // Triage list: what a fleet manager needs to act on for this driver, most serious first.
  // A row links only where the destination can resolve it; the rest are plain text.
  const attention: { tone: Tone; text: string; href?: string }[] = risks.map((r) => ({ ...r, href: r.text.startsWith("Score") ? `/drivers/${id}?tab=performance` : `/drivers/${id}?tab=documents` }));
  if (driver.hold) attention.push({ tone: "warn", text: `On hold${driver.holdReason ? ` — ${driver.holdReason}` : ""}. Dispatch cannot assign loads until released.` });
  if (missingDocs.length) attention.push({ tone: "warn", text: `Paperwork incomplete: ${missingDocs.map((k) => DOC_KIND_LABELS[k].toLowerCase()).join(", ")} not on file`, href: `/drivers/${id}?tab=documents` });
  if (idleDays >= IDLE_DAYS) attention.push({ tone: "info", text: `Ready for ${idleDays}d with no load assigned`, href: `/dispatch?driver=${id}` });
  if (driver.status === "ACTIVE" && !driver.truck) attention.push({ tone: "info", text: "No truck assigned", href: "/fleet" });
  // The edit form creates the login (email + password) for a driver who has none.
  if (driver.status === "ACTIVE" && !driver.user) {
    attention.push({ tone: "neutral", text: "No app login — the driver cannot update stops or upload PODs from the road", href: can(user.role, "drivers.edit") ? `/drivers/${id}/edit` : undefined });
  }
  if (driver.status === "ACTIVE" && driver.user && !driver.user.active) {
    attention.push({ tone: "warn", text: "App login is deactivated", href: can(user.role, "users.manage") ? `/admin/users/${driver.user.id}` : undefined });
  }

  const tabs = TABS.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/drivers/${id}${t === "overview" ? "" : `?tab=${t}`}`,
    count: t === "documents" ? missingDocs.length || undefined : t === "loads" ? driver._count.loads || undefined : t === "history" ? driver._count.statusEvents || undefined : undefined,
  }));

  const boardLabel = BOARD_STATUS_LABELS[driver.boardStatus as BoardStatus] ?? driver.boardStatus;
  const progress = active?.status === "IN_TRANSIT" ? loadProgress(active) : null;
  const eta = active?.status === "IN_TRANSIT" ? estimatedArrival(active) : null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/drivers" className="hover:text-fg">Drivers</Link>}
        title={driver.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge value={driver.status} label={EMPLOYMENT_LABELS[driver.status] ?? driver.status} dot />
            <span className="inline-flex items-center gap-1.5">
              <Badge value={driver.boardStatus} label={boardLabel} />
              <span className="num text-[11px] text-fg-subtle" title={`Since ${dateTime(driver.boardStatusSince)}`}>for {sinceShort(driver.boardStatusSince)}</span>
              {driver.boardStatusManual && <Chip title="A dispatcher overrode the automatic status">Manual</Chip>}
            </span>
            <Chip tone={DRIVER_TYPE_TONE[driver.type]} className="normal-case tracking-normal">{DRIVER_TYPE_LABELS[driver.type] ?? driver.type}</Chip>
            <span className="inline-flex items-center gap-1.5 text-fg-muted"><TeamDot color={driver.team?.color} />{driver.team?.name ?? "No team"}</span>
            {driver.hold && <Chip tone="warn" title={driver.holdReason ?? "On hold"}>Hold</Chip>}
          </span>
        }
        actions={editable && (
          <>
            <HoldControl id={id} name={driver.name} hold={driver.hold} reason={driver.holdReason} />
            <EmploymentMenu id={id} status={driver.status} />
            <LinkButton href={`/drivers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
          </>
        )}
      />

      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="Needs attention" flush actions={attention.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{attention.length}</span>}>
              {attention.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-fg-muted"><StatusDot tone="ok" />Nothing open — papers valid, score {driver.score}, not on hold.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.map((a, i) => (
                    <li key={i}>
                      {a.href ? (
                        <Link href={a.href} className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg hover:bg-raised">
                          <StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span><ChevronRight className="h-3.5 w-3.5 text-fg-faint" />
                        </Link>
                      ) : (
                        <p className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg"><StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span></p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Current assignment">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="eyebrow mb-1">Truck</p>
                  {driver.truck ? (
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-subtle"><TruckIcon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <Link href={`/fleet/${driver.truck.id}`} className="num text-[13px] font-semibold text-fg hover:underline">{driver.truck.unitNumber}</Link>
                        <p className="truncate text-[12px] text-fg-muted">{driver.truck.year} {driver.truck.make} {driver.truck.model} · <span className="num">{driver.truck.plate}</span></p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                          <Badge value={driver.truck.status} />
                          {driver.truck.locationName && <span>{driver.truck.locationName}{driver.truck.lastPingAt && ` · ${ago(driver.truck.lastPingAt)}`}</span>}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-fg-muted">No truck assigned{can(user.role, "fleet.edit") && <> · <Link href="/fleet" className="text-fg hover:underline">pick a unit</Link></>}</p>
                  )}
                </div>
                <div>
                  <p className="eyebrow mb-1">Load</p>
                  {active ? (
                    <div className="rounded-md border border-line bg-raised p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/loads/${active.id}`} className="num text-[13px] font-semibold text-fg hover:underline">{active.reference}</Link>
                        <Badge value={active.status} label={LOAD_STATUS_LABELS[active.status as LoadStatus]} />
                      </div>
                      <p className="mt-1 text-[13px] text-fg">{active.originCity} → {active.destCity}</p>
                      <p className="text-[11px] text-fg-subtle">{active.customer.name} · {km(active.distanceKm)}</p>
                      {progress != null && (
                        <>
                          <Progress value={progress} className="mt-2" />
                          <div className="mt-1 flex justify-between text-[11px] text-fg-subtle">
                            <span className="num">{Math.round(progress * 100)}%</span>
                            {eta && <span className={cn("num", eta > active.deliveryAt && "text-danger")}>ETA {dateTime(eta)}{eta > active.deliveryAt && " · late"}</span>}
                          </div>
                        </>
                      )}
                      {active.status === "ASSIGNED" && <p className="mt-1 text-[11px] text-info">Pickup {dateTime(active.pickupAt)}</p>}
                    </div>
                  ) : (
                    <p className="text-[13px] text-fg-muted">
                      {driver.status !== "ACTIVE" ? `Not dispatchable while ${(EMPLOYMENT_LABELS[driver.status] ?? driver.status).toLowerCase()}`
                        : driver.hold ? "On hold — not taking loads"
                        : `${boardLabel}${driver.boardStatus === "READY" ? " — available for dispatch" : ""}`}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Last 90 days" actions={<Link href={`/drivers/${id}?tab=performance`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Performance →</Link>}>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
                <Figure label="Loads" value={number(recent.loads)} />
                <Figure label="Distance" value={km(recent.km)} hint={recent.emptyPct != null ? `${recent.emptyPct}% empty` : undefined} />
                <Figure label="On time" value={recent.onTimePct == null ? "—" : `${recent.onTimePct}%`} tone={onTimeTone(recent.onTimePct)} />
                <Figure label={showEarnings ? "Earnings" : "Revenue"} value={money(showEarnings ? recent.pay : recent.revenue)} hint={recent.revPerKm != null ? `${money2(recent.revPerKm)}/km revenue` : undefined} />
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Contact">
              <DL items={[
                ["Phone", driver.phone ? <a key="p" href={`tel:${driver.phone}`} className="num inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5 text-fg-subtle" />{driver.phone}</a> : "—"],
                ["Second phone", driver.phone2 ? <a key="p2" href={`tel:${driver.phone2}`} className="num hover:underline">{driver.phone2}</a> : "—"],
                ["Email", driver.email ? <a key="e" href={`mailto:${driver.email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail className="h-3.5 w-3.5 text-fg-subtle" />{driver.email}</a> : "—"],
                ["App login", driver.user
                  ? <span key="u" className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-fg-subtle" /><Badge value={driver.user.active ? "ACTIVE" : "INACTIVE"} label={driver.user.active ? "Enabled" : "Deactivated"} /></span>
                  : <span key="u" className="text-fg-muted">Not enabled</span>],
                ["Last seen", driver.user?.lastLoginAt ? ago(driver.user.lastLoginAt) : "—"],
              ]} />
            </Card>

            <Card title="Licence & medical" actions={<Link href={`/drivers/${id}?tab=documents`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Documents →</Link>}>
              <DL items={[
                ["Licence", <span key="l" className="num">{driver.licenseNumber} · {driver.licenseClass}</span>],
                ["Licence expiry", <span key="le" className="flex items-center gap-2"><span className="num">{date(driver.licenseExpiry)}</span><ExpiryBadge days={daysUntil(driver.licenseExpiry)} /></span>],
                ["Medical certificate", <span key="me" className="flex items-center gap-2"><span className="num">{date(driver.medicalExpiry)}</span><ExpiryBadge days={daysUntil(driver.medicalExpiry)} /></span>],
                ["Scans on file", <span key="d" className={cn("num", missingDocs.length ? "text-warn" : "text-ok")}>{REQUIRED_DRIVER_DOCS.length - missingDocs.length}/{REQUIRED_DRIVER_DOCS.length}</span>],
              ]} />
            </Card>

            <Card title="Employment">
              <DL items={[
                ["Type", DRIVER_TYPE_LABELS[driver.type] ?? driver.type],
                ["Team", <span key="t" className="inline-flex items-center gap-1.5"><TeamDot color={driver.team?.color} />{driver.team?.name ?? "No team"}</span>],
                ["Hired", <span key="h"><span className="num">{date(driver.hireDate)}</span> <span className="text-fg-subtle">· {tenure(driver.hireDate)}</span></span>],
                ["Pay per km", <span key="pay" className="num">{money2(driver.payPerKm)}</span>],
                ["Score", <span key="s" className="inline-flex items-center gap-1.5"><Badge value={grade.grade} tone={grade.tone} label={`${grade.grade} · ${driver.score}`} className="num" /></span>],
                ["Rating", <span key="r" className="num inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-accent text-accent" />{driver.rating.toFixed(1)}</span>],
              ]} />
            </Card>

            <Card title="Notes">
              {driver.notes ? <p className="whitespace-pre-wrap text-[13px] text-fg">{driver.notes}</p>
                : <p className="text-[12px] text-fg-muted">No notes.{editable && <> Add preferences, languages or restrictions on the <Link href={`/drivers/${id}/edit`} className="text-fg hover:underline">edit form</Link>.</>}</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === "performance" && <PerformanceTab recentLoads={recentLoads} lifetime={lifetime} recent={recent} score={driver.score} rating={driver.rating} payPerKm={driver.payPerKm} showEarnings={showEarnings} />}

      {tab === "documents" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DocumentsPanel user={user} target={{ type: "driver", id }} path={`/drivers/${id}`} withExpiry required={[...REQUIRED_DRIVER_DOCS]} />
          </div>
          <Card title={
            <span className="flex items-center gap-1.5">Required paperwork
              <InfoTip>Licence and medical certificate scans must be on file for every driver. Set an expiry when you upload so renewals surface as alerts and on the roster.</InfoTip>
            </span>
          } flush>
            <Table dense stickyHead={false} head={["Document", "On file",
              <span key="exp" className="inline-flex items-center gap-1">Expires<InfoTip>Recorded dates come from the driver record; document dates from the uploaded file. Edit the record to change recorded dates.</InfoTip></span>]}>
              {REQUIRED_DRIVER_DOCS.map((kind) => {
                const doc = docRows.find((d) => d.kind === kind);
                const recorded = driver[DOC_FIELD[kind]];
                const expiry = doc?.expiresAt ?? recorded;
                return (
                  <tr key={kind}>
                    <td>
                      <div className="text-fg">{DOC_KIND_LABELS[kind]}</div>
                      {doc && <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="block max-w-44 truncate text-[11px] text-fg-subtle hover:underline">{doc.name}</a>}
                    </td>
                    <td>{doc ? <Badge value="DONE" label="Present" /> : <Badge value="MISSING_DOCS" label="Missing" />}</td>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        <ExpiryBadge days={daysUntil(expiry)} />
                        {expiry && <span className="text-[11px] text-fg-subtle">{date(expiry)}{!doc?.expiresAt && recorded ? " · from record" : ""}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}

      {tab === "loads" && <LoadsTab driverId={id} showEarnings={showEarnings} />}
      {tab === "history" && <HistoryTab driverId={id} current={{ status: driver.boardStatus, since: driver.boardStatusSince, manual: driver.boardStatusManual }} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Figure({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: Tone }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={cn("num mt-1 truncate text-[18px] font-semibold leading-tight", color)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

type Perf = ReturnType<typeof performance>;
type DoneRow = { rate: number; driverPay: number; distanceKm: number; emptyKm: number; deliveredAt: Date | null; deliveryAt: Date };

/** `recentLoads`: completed loads delivered in the last 90 days, which covers the 8-week table. */
function PerformanceTab({ recentLoads, lifetime, recent, score, rating, payPerKm, showEarnings }: {
  recentLoads: DoneRow[]; lifetime: Perf; recent: Perf; score: number; rating: number; payPerKm: number; showEarnings: boolean;
}) {
  const grade = scoreGrade(score);
  const weekStart = startOfWeek(subWeeks(new Date(), WEEKS - 1), { weekStartsOn: 1 });
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: addWeeks(weekStart, i), loads: 0, km: 0, revenue: 0, pay: 0 }));
  for (const l of recentLoads) {
    if (!l.deliveredAt || l.deliveredAt < weekStart) continue;
    const i = Math.min(WEEKS - 1, Math.floor((l.deliveredAt.getTime() - weekStart.getTime()) / (7 * 86_400_000)));
    const w = weeks[i];
    w.loads += 1; w.km += l.distanceKm; w.revenue += l.rate; w.pay += l.driverPay;
  }
  const total8 = weeks.reduce((a, w) => a + w.revenue, 0);
  const activeWeeks = weeks.filter((w) => w.loads > 0).length;
  const thisWeek = weeks[WEEKS - 1];
  const lastWeek = weeks[WEEKS - 2];
  const delta = lastWeek.revenue ? Math.round(((thisWeek.revenue - lastWeek.revenue) / lastWeek.revenue) * 100) : null;
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
  const cmp = (l: number | null, r: number | null) => (l == null || r == null ? "—" : `${r - l > 0 ? "+" : ""}${number(r - l)}`);

  const rows: { label: string; lifetime: string; recent: string; delta?: string; money?: boolean }[] = [
    { label: "Loads delivered", lifetime: number(lifetime.loads), recent: number(recent.loads) },
    { label: "Distance", lifetime: km(lifetime.km), recent: km(recent.km) },
    { label: "Empty km share", lifetime: pct(lifetime.emptyPct), recent: pct(recent.emptyPct) },
    { label: "On-time deliveries", lifetime: pct(lifetime.onTimePct), recent: pct(recent.onTimePct), delta: lifetime.onTimePct != null && recent.onTimePct != null ? `${recent.onTimePct - lifetime.onTimePct > 0 ? "+" : ""}${recent.onTimePct - lifetime.onTimePct} pts` : undefined },
    { label: "Revenue", lifetime: money(lifetime.revenue), recent: money(recent.revenue) },
    { label: "Avg revenue per load", lifetime: lifetime.avgRevenue == null ? "—" : money(lifetime.avgRevenue), recent: recent.avgRevenue == null ? "—" : money(recent.avgRevenue), delta: lifetime.avgRevenue != null && recent.avgRevenue != null ? cmp(Math.round(lifetime.avgRevenue), Math.round(recent.avgRevenue)) : undefined },
    { label: "Revenue per km", lifetime: lifetime.revPerKm == null ? "—" : money2(lifetime.revPerKm), recent: recent.revPerKm == null ? "—" : money2(recent.revPerKm) },
    ...(showEarnings ? [
      { label: "Earnings (driver pay)", lifetime: money(lifetime.pay), recent: money(recent.pay) },
      { label: "Pay share of revenue", lifetime: lifetime.revenue ? `${Math.round((lifetime.pay / lifetime.revenue) * 100)}%` : "—", recent: recent.revenue ? `${Math.round((recent.pay / recent.revenue) * 100)}%` : "—" },
    ] : []),
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Score" value={<span className="inline-flex items-center gap-2">{score}<Badge value={grade.grade} tone={grade.tone} label={grade.grade} /></span>} tone={grade.tone}
          hint={score < 75 ? "below the at-risk line of 75" : `rating ${rating.toFixed(1)} of 5`} />
        <Stat label="Loads (90d)" value={recent.loads} hint={`${number(lifetime.loads)} lifetime`} />
        <Stat label="Distance (90d)" value={km(recent.km)} hint={recent.emptyPct != null ? `${recent.emptyPct}% of km empty` : `${km(lifetime.km)} lifetime`} />
        <Stat label="On time (90d)" value={recent.onTimePct == null ? "—" : `${recent.onTimePct}%`} tone={onTimeTone(recent.onTimePct)}
          hint={lifetime.onTimePct == null ? "no completed loads" : `${lifetime.onTimePct}% lifetime`} />
        {showEarnings
          ? <Stat label="Earnings (90d)" value={money(recent.pay)} hint={`${money2(payPerKm)}/km contract rate`} />
          : <Stat label="Avg revenue per load" value={recent.avgRevenue == null ? "—" : money(recent.avgRevenue)} hint={lifetime.avgRevenue == null ? undefined : `${money(lifetime.avgRevenue)} lifetime`} />}
        <Stat label={`Revenue (${WEEKS} wk)`} value={money(total8)} delta={delta == null ? undefined : `${delta > 0 ? "+" : ""}${delta}%`}
          spark={<Spark data={weeks.map((w) => w.revenue)} />} hint={`${activeWeeks} of ${WEEKS} weeks with deliveries`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card flush className="xl:col-span-2" title={
          <span className="flex items-center gap-1.5">Lifetime vs last 90 days
            <InfoTip>Delivered and invoiced loads, counted by delivery date. On time = delivered within the appointment window.{showEarnings && " Earnings are driver pay recorded on each load."}</InfoTip>
          </span>
        }>
          <Table dense stickyHead={false} head={["Metric", "Lifetime", "Last 90 days", "Change"]}>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="text-fg">{r.label}</td>
                <td className="num text-fg-muted">{r.lifetime}</td>
                <td className="num font-medium text-fg">{r.recent}</td>
                <td className={cn("num text-[12px]", r.delta?.startsWith("+") ? "text-ok" : r.delta?.startsWith("-") ? "text-danger" : "text-fg-subtle")}>{r.delta ?? ""}</td>
              </tr>
            ))}
          </Table>
          {lifetime.loads === 0 && <EmptyState title="No completed loads yet" description="Performance figures appear once this driver delivers their first load." />}
        </Card>

        <Card title={<span className="flex items-center gap-1.5">Weekly revenue · last {WEEKS} weeks<InfoTip>Weeks start on Monday. The weekly board has goals and the team view.</InfoTip></span>} flush actions={<Link href={`/dispatch/weekly`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Weekly board →</Link>}>
          <Table dense stickyHead={false} head={["Week", "Loads", "km", "Revenue", ...(showEarnings ? ["Pay"] : [])]}>
            {[...weeks].reverse().map((w, i) => (
              <tr key={w.start.toISOString()} className={i === 0 ? "bg-raised/60" : undefined}>
                <td className="whitespace-nowrap"><span className="num text-fg">{format(w.start, "dd MMM")}</span>{i === 0 && <span className="ml-1.5 text-[11px] text-accent-text">this week</span>}</td>
                <td className="num">{w.loads || <span className="text-fg-faint">—</span>}</td>
                <td className="num text-fg-muted">{w.km ? number(Math.round(w.km)) : <span className="text-fg-faint">—</span>}</td>
                <td className="num font-medium">{w.revenue ? money(w.revenue) : <span className="text-fg-faint">—</span>}</td>
                {showEarnings && <td className="num text-fg-muted">{w.pay ? money(w.pay) : <span className="text-fg-faint">—</span>}</td>}
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

async function LoadsTab({ driverId, showEarnings }: { driverId: string; showEarnings: boolean }) {
  const loads = await db.load.findMany({
    where: { driverId }, orderBy: { pickupAt: "desc" }, take: 100,
    select: {
      id: true, reference: true, status: true, originCity: true, destCity: true, pickupAt: true, deliveryAt: true, deliveredAt: true, distanceKm: true, emptyKm: true, rate: true, driverPay: true,
      customer: { select: { id: true, name: true } }, broker: { select: { id: true, name: true } }, truck: { select: { id: true, unitNumber: true } },
    },
  });
  const activeFirst = [...loads].sort((a, b) => Number((ACTIVE_LOAD_STATUSES as readonly string[]).includes(b.status)) - Number((ACTIVE_LOAD_STATUSES as readonly string[]).includes(a.status)));
  const delivered = loads.filter((l) => l.deliveredAt);
  const late = delivered.filter((l) => l.deliveredAt! > l.deliveryAt).length;
  return (
    <Card title="Load history" flush actions={<span className="text-[11px] text-fg-subtle" title="Active loads are listed first, then the newest."><span className="num">{loads.length}</span> loads · <span className="num">{late}</span> late deliveries{loads.length === 100 && " · showing the latest 100"}</span>}>
      <Table head={["Load", "Status", "Route", "Customer", "Pickup", "Delivered",
        <span key="km" className="inline-flex items-center gap-1">Distance<InfoTip>Loaded km, plus empty repositioning km where recorded.</InfoTip></span>,
        "Rate", ...(showEarnings ? ["Pay"] : []), "Truck"]}>
        {activeFirst.map((l) => {
          const isLate = l.deliveredAt && l.deliveredAt > l.deliveryAt;
          return (
            <tr key={l.id} className={l.status === "CANCELLED" ? "opacity-60" : undefined}>
              <td><Link href={`/loads/${l.id}`} className="num font-medium text-fg hover:underline">{l.reference}</Link></td>
              <td><Badge value={l.status} label={LOAD_STATUS_LABELS[l.status as LoadStatus] ?? l.status} /></td>
              <td className="whitespace-nowrap text-fg">{l.originCity} → {l.destCity}</td>
              <td className="max-w-48"><Cell primary={<Link href={`/customers/${l.customer.id}`} className="hover:underline">{l.customer.name}</Link>} secondary={l.broker ? <>via <Link href={`/customers/${l.broker.id}`} className="hover:underline">{l.broker.name}</Link></> : undefined} /></td>
              <td className="num whitespace-nowrap text-fg-muted">{dateTime(l.pickupAt)}</td>
              <td className="whitespace-nowrap">
                {l.deliveredAt ? <span className={cn("num", isLate ? "text-danger" : "text-fg-muted")}>{dateTime(l.deliveredAt)}{isLate && <span className="ml-1 text-[11px]">late</span>}</span> : <span className="num text-fg-subtle">due {dateTime(l.deliveryAt)}</span>}
              </td>
              <td className="num text-fg-muted">{number(l.distanceKm)}{l.emptyKm > 0 && <span className="text-[11px] text-fg-subtle"> +{number(l.emptyKm)}</span>}</td>
              <td className="num">{money(l.rate)}</td>
              {showEarnings && <td className="num text-fg-muted">{l.driverPay ? money(l.driverPay) : <span className="text-fg-faint">—</span>}</td>}
              <td>{l.truck ? <Link href={`/fleet/${l.truck.id}`} className="num hover:underline">{l.truck.unitNumber}</Link> : <span className="text-fg-faint">—</span>}</td>
            </tr>
          );
        })}
      </Table>
      {loads.length === 0 && <EmptyState title="No loads yet" description="Loads assigned to this driver appear here, newest first." />}
    </Card>
  );
}

/** A status event is written a moment after the driver record changes; allow for that gap when pairing them. */
const LOG_SKEW_MS = 60_000;
const HISTORY_LIMIT = 150;
type TimelineEntry = { id: string; status: string; source: string; note: string | null; at: Date; user: { name: string } | null; unlogged?: boolean };

async function HistoryTab({ driverId, current }: { driverId: string; current: { status: string; since: Date; manual: boolean } }) {
  const events = await db.driverStatusEvent.findMany({
    where: { driverId }, orderBy: { at: "desc" }, take: HISTORY_LIMIT,
    select: { id: true, status: true, source: true, note: true, at: true, user: { select: { name: true } } },
  });
  const now = new Date().getTime();
  const sinceMs = current.since.getTime();

  // The driver record (what the board shows) is the source of truth for the current status, so the log is reconciled
  // with it and the timeline, the shares and "Right now" agree:
  //  - the event that opened the current status supplies who and why; the record supplies when;
  //  - if none was logged (some employment changes write the board directly), the top row is built from the record;
  //  - log entries newer than the record never reached the board and are left out (counted in a footnote).
  const openerIdx = events.findIndex((e) => e.status === current.status && Math.abs(e.at.getTime() - sinceMs) <= LOG_SKEW_MS);
  const older = openerIdx >= 0 ? events.slice(openerIdx + 1) : events.filter((e) => e.at.getTime() <= sinceMs);
  const skipped = openerIdx >= 0 ? openerIdx : events.length - older.length;
  const head: TimelineEntry = openerIdx >= 0
    ? { ...events[openerIdx], at: current.since }
    : { id: "current", status: current.status, source: current.manual ? "MANUAL" : "AUTO", note: null, at: current.since, user: null, unlogged: true };
  const timeline: TimelineEntry[] = [head, ...older];
  // Each entry lasts until the next (newer) one; the first is still running.
  const rows = timeline.map((e, i) => ({ ...e, until: i === 0 ? null : timeline[i - 1].at, ms: Math.max(0, (i === 0 ? now : timeline[i - 1].at.getTime()) - e.at.getTime()) }));
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + r.ms);
  const totalMs = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const share = [...byStatus].map(([status, ms]) => ({ status, ms })).sort((a, b) => b.ms - a.ms);
  const manual = rows.filter((r) => r.source === "MANUAL").length;
  const label = (s: string) => BOARD_STATUS_LABELS[s as BoardStatus] ?? s;
  const span = rows[rows.length - 1].at;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card flush className="xl:col-span-2"
        title={
          <span className="flex items-center gap-1.5">Status timeline
            <InfoTip>
              Changes are logged automatically from loads and when a dispatcher overrides the board.
              {skipped > 0 && ` ${skipped} later log ${skipped === 1 ? "entry doesn't" : "entries don't"} match the board status and ${skipped === 1 ? "is" : "are"} left out of the timings.`}
            </InfoTip>
          </span>
        }
        actions={<span className="text-[11px] text-fg-subtle"><span className="num">{rows.length}</span> {rows.length === 1 ? "change" : "changes"} · <span className="num">{manual}</span> manual{events.length === HISTORY_LIMIT && ` · latest ${HISTORY_LIMIT}`}</span>}>
        <ol className="divide-y divide-line">
          {rows.map((r, i) => {
            const tone = STATUS_TONE[r.status] ?? "neutral";
            return (
              <li key={r.id} className={cn("flex items-start gap-3 px-4 py-2.5", i === 0 && "bg-raised/60")}>
                <span className="mt-1.5 flex flex-col items-center self-stretch">
                  <StatusDot tone={tone} pulse={i === 0} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge value={r.status} label={label(r.status)} />
                    <Chip tone={r.source === "MANUAL" ? "accent" : "neutral"} title={r.source === "MANUAL" ? "Set by a dispatcher" : "Derived from the load"}>{r.source === "MANUAL" ? "Manual" : "Auto"}</Chip>
                    {r.user?.name && <span className="text-[12px] text-fg-muted">by {r.user.name}</span>}
                    {!r.user?.name && r.source === "AUTO" && !r.unlogged && <span className="text-[12px] text-fg-subtle">system</span>}
                    {r.unlogged && <span className="text-[12px] text-fg-subtle" title="This change has no log entry. Status and start time come from the driver record, as on the board.">not logged</span>}
                  </div>
                  {r.note && <p className="mt-1 text-[13px] text-fg">{r.note}</p>}
                  <p className="num mt-1 text-[11px] text-fg-subtle">{dateTime(r.at)}{r.until ? ` → ${dateTime(r.until)}` : " → now"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[13px] font-medium text-fg">{fmtDuration(r.ms)}</p>
                  <p className="text-[11px] text-fg-subtle">{i === 0 ? "so far" : "in status"}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {events.length === 0 && <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">Nothing logged yet.</p>}
      </Card>

      <div className="space-y-4">
        <Card title={<span className="flex items-center gap-1.5">Time in each status<InfoTip>Share of the recorded history. Ready time with no load is the gap dispatch can close.</InfoTip></span>}
          actions={span && <span className="text-[11px] text-fg-subtle">since {date(span)}</span>}>
          {share.length === 0 ? <p className="text-[12px] text-fg-muted">Nothing to summarise yet.</p> : (
            <ul className="space-y-2">
              {share.map((s) => {
                const tone = STATUS_TONE[s.status] ?? "neutral";
                const pct = totalMs ? (s.ms / totalMs) * 100 : 0;
                return (
                  <li key={s.status}>
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="inline-flex items-center gap-1.5 text-fg"><StatusDot tone={tone} />{label(s.status)}</span>
                      <span className="num text-fg-muted">{fmtDuration(s.ms)} <span className="text-fg-subtle">· {Math.round(pct)}%</span></span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className={cn("h-full rounded-full", TONE_DOT[tone])} style={{ width: `${Math.max(1, Math.round(pct))}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Right now">
          <DL cols={1} items={[
            ["Board status", <span key="s" className="inline-flex items-center gap-2"><Badge value={current.status} label={label(current.status)} dot />{current.manual && <Chip tone="accent">Manual</Chip>}</span>],
            ["Since", <span key="t"><span className="num">{dateTime(current.since)}</span> <span className="text-fg-subtle">· {fmtDuration(now - current.since.getTime())}</span></span>],
            ["Source", current.manual ? "Dispatcher override — restore the automatic value from the board" : "Derived from the driver's load and stop progress"],
          ]} />
        </Card>
      </div>
    </div>
  );
}
