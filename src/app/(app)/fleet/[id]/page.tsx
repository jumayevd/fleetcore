import Link from "next/link";
import { notFound } from "next/navigation";
import { format, startOfMonth, subMonths } from "date-fns";
import { ChevronRight, Pencil, Wrench, Gauge, Fuel, Power, Compass, Radio, MapPin, Phone } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BOARD_STATUS_LABELS, LOAD_STATUS_LABELS, OWNERSHIP_LABELS, WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS, type BoardStatus, type LoadStatus } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS, DOC_KIND_LABELS } from "@/lib/documents";
import { money, money2, number, date, dateTime, ago, daysUntil, km, toDateInput, daysAgo } from "@/lib/format";
import { estimatedArrival, loadProgress, loadRoute, syncSimulatedPositions } from "@/lib/telemetry";
import { saveMaintenance, addFuelLog, addTruckNote } from "@/app/actions/fleet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Chip, DL, EmptyState, ExpiryBadge, Field, InfoTip, Input, LinkButton, PageHeader, Progress, Select, Stat, StatusDot, Table, Tabs, Textarea, cn, type Tone } from "@/components/ui";
import { Spark } from "@/components/charts-lite";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { TruckStatusMenu } from "./status-menu";
import { WorkOrderActions } from "../work-order-actions";
import {
  COMPLETED_LOAD_STATUSES, compass, docExpiryByUnit, EXPIRY_SOON_DAYS, FUEL_TYPE_LABELS, fuelTone, leaseStatus, missingDocs, OWNERSHIP_TONE, paperworkExpiry, parseNotes,
  pingSourceLabel, pingStale, pmStatus, TRUCK_STATUS_LABELS,
} from "../lib";

const TABS = ["overview", "maintenance", "specs", "financial", "compliance", "loads"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", maintenance: "Maintenance", specs: "Specs", financial: "Financial", compliance: "Compliance", loads: "Loads" };
const DOC_FIELD: Record<string, "registrationExpiry" | "insuranceExpiry" | "inspectionExpiry"> = { REGISTRATION: "registrationExpiry", INSURANCE: "insuranceExpiry", INSPECTION: "inspectionExpiry" };

export async function generateMetadata({ params }: PageProps<"/fleet/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.truck.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: r?.unitNumber ?? "Not found" };
}

export default async function TruckDetail({ params, searchParams }: PageProps<"/fleet/[id]">) {
  const user = await requireUser("fleet.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  const editable = can(user.role, "fleet.edit");
  const showRevenue = can(user.role, "finance.view") || can(user.role, "loads.edit") || can(user.role, "reports.view");

  await syncSimulatedPositions();
  const truck = await db.truck.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true, phone: true, boardStatus: true, hold: true, type: true } },
      trailers: { select: { id: true, unitNumber: true, type: true, status: true }, orderBy: { unitNumber: "asc" } },
      loads: {
        where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] } }, orderBy: { pickupAt: "asc" }, take: 1,
        include: { customer: { select: { name: true } }, stops: { select: { lat: true, lng: true, seq: true, status: true, type: true, name: true, city: true }, orderBy: { seq: "asc" } } },
      },
      _count: { select: { loads: true } },
    },
  });
  if (!truck) notFound();

  const [docRows, openWo] = await Promise.all([
    db.document.findMany({ where: { truckId: id, kind: { in: [...REQUIRED_UNIT_DOCS] } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, expiresAt: true } }),
    db.workOrder.count({ where: { truckId: id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);
  const have = new Set(docRows.map((d) => d.kind));
  const missing = missingDocs(have, REQUIRED_UNIT_DOCS);
  // Earlier of the record date and the newest uploaded document's expiry, so a stale record can't hide an expired paper.
  const paper = paperworkExpiry(truck, docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id));
  const fuelLabel = FUEL_TYPE_LABELS[truck.fuelType] ?? truck.fuelType;
  const pm = pmStatus(truck);
  const lease = leaseStatus(truck);
  const active = truck.loads[0] ?? null;
  const progress = active?.status === "IN_TRANSIT" ? loadProgress(active) : null;
  const eta = active?.status === "IN_TRANSIT" ? estimatedArrival(active) : null;
  const stale = pingStale(truck.lastPingAt);

  // Exceptions on this unit — the triage list a fleet manager reads first.
  const attention: { tone: Tone; text: string; href: string }[] = [];
  if (pm.state === "overdue") attention.push({ tone: "danger", text: `PM overdue by ${number(-(pm.left ?? 0))} km`, href: `/fleet/${id}?tab=maintenance` });
  else if (pm.state === "due") attention.push({ tone: "warn", text: `PM due in ${number(pm.left ?? 0)} km`, href: `/fleet/${id}?tab=maintenance` });
  if (lease?.state === "over") attention.push({ tone: "danger", text: `${number(lease.overKm)} km over the lease cap · ${money(lease.exposure)} exposure`, href: `/fleet/${id}?tab=financial` });
  else if (lease && lease.state !== "ok") attention.push({ tone: "warn", text: `${number(lease.remainingKm)} km left before the lease hard cap`, href: `/fleet/${id}?tab=financial` });
  for (const kind of REQUIRED_UNIT_DOCS) {
    const d = daysUntil(paper[kind]);
    if (d != null && d < 0) attention.push({ tone: "danger", text: `${DOC_KIND_LABELS[kind]} expired ${-d}d ago`, href: `/fleet/${id}?tab=compliance` });
    else if (d != null && d <= EXPIRY_SOON_DAYS) attention.push({ tone: "warn", text: `${DOC_KIND_LABELS[kind]} expires in ${d}d`, href: `/fleet/${id}?tab=compliance` });
  }
  if (missing.length) attention.push({ tone: "warn", text: `Paperwork incomplete: ${missing.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")} not on file`, href: `/fleet/${id}?tab=compliance` });
  // Assigning happens on the edit form; viewers without fleet.edit go to the drivers list instead of a redirect.
  if (truck.status === "ACTIVE" && !truck.driver) attention.push({ tone: "info", text: "No driver assigned", href: editable ? `/fleet/${id}/edit` : "/drivers" });
  if (truck.status === "MAINTENANCE" && openWo === 0) attention.push({ tone: "info", text: "In shop with no open work order", href: `/fleet/${id}?tab=maintenance` });
  if (truck.status === "ACTIVE" && stale && truck.lastPingAt) attention.push({ tone: "neutral", text: `No position update for ${ago(truck.lastPingAt).replace(" ago", "")}`, href: `/fleet/${id}` });

  const tabs = TABS.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/fleet/${id}${t === "overview" ? "" : `?tab=${t}`}`,
    count: t === "maintenance" ? openWo || undefined : t === "loads" ? truck._count.loads || undefined : t === "compliance" ? missing.length || undefined : undefined,
  }));

  return (
    <>
      <PageHeader
        eyebrow={`${truck.year} ${truck.make} ${truck.model}`}
        title={<span className="num">{truck.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge value={truck.status} label={TRUCK_STATUS_LABELS[truck.status]} dot />
            <Chip tone={OWNERSHIP_TONE[truck.ownership]} className="normal-case tracking-normal">{OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership}</Chip>
            <span>Plate <span className="num text-fg">{truck.plate}</span></span>
            <InfoTip>VIN {truck.vin ?? "—"}{truck.group ? ` · ${truck.group} group` : ""}</InfoTip>
          </span>
        }
        actions={editable && (
          <>
            <TruckStatusMenu id={id} status={truck.status} />
            <LinkButton href={`/fleet/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
            <LinkButton href={`/fleet/${id}?tab=maintenance#new-work-order`}><Wrench />New work order</LinkButton>
          </>
        )}
      />

      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="Needs attention" bodyClassName="p-0" actions={attention.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{attention.length}</span>}>
              {attention.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-fg-muted"><StatusDot tone="ok" />No open issues on this unit.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.map((a, i) => (
                    <li key={i}>
                      <Link href={a.href} className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg hover:bg-raised">
                        <StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span><ChevronRight className="h-3.5 w-3.5 text-fg-faint" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Telematics" flush actions={
              <span className="inline-flex items-center gap-2 text-[11px] text-fg-subtle">
                <StatusDot tone={stale ? "neutral" : "accent"} pulse={!stale} />
                {truck.lastPingAt ? `${ago(truck.lastPingAt)} · ${pingSourceLabel(truck.pingSource)}` : "No position yet"}
              </span>
            }>
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
                <Metric icon={<Gauge />} label="Speed" value={`${Math.round(truck.speedKmh ?? 0)}`} unit="km/h" hint={(truck.speedKmh ?? 0) > 1 ? "Moving" : "Stopped"} />
                <Metric icon={<Fuel />} label="Fuel" value={truck.fuelPct == null ? "—" : `${Math.round(truck.fuelPct)}`} unit={truck.fuelPct == null ? undefined : "%"}
                  hint={truck.fuelPct == null ? "no sensor" : `≈ ${number(Math.round((truck.fuelPct / 100) * truck.fuelCapacityL))} of ${number(truck.fuelCapacityL)} L`}
                  bar={truck.fuelPct == null ? undefined : { value: truck.fuelPct / 100, tone: fuelTone(truck.fuelPct) }} />
                <Metric icon={<Power />} label="Engine" value={truck.engineOn == null ? "—" : truck.engineOn ? "On" : "Off"} tone={truck.engineOn ? "ok" : "neutral"} hint={truck.fuelEconomy ? `${truck.fuelEconomy.toFixed(1)} L/100km rolling` : undefined} />
                <Metric icon={<MapPin />} label="Location" value={truck.locationName ?? "Unknown"} small hint={truck.lat != null && truck.lng != null ? `${truck.lat.toFixed(4)}, ${truck.lng.toFixed(4)}` : undefined} />
                <Metric icon={<Compass />} label="Heading" value={compass(truck.heading)} hint={truck.heading != null ? `${Math.round(truck.heading)}°` : undefined} />
                <Metric icon={<Radio />} label="Last ping" value={truck.lastPingAt ? ago(truck.lastPingAt).replace(" ago", "") : "—"} small hint={pingSourceLabel(truck.pingSource)} tone={stale ? "warn" : "neutral"} />
              </div>
              <div className="p-2">
                <LeafletMap height={240} fitKey={id} trucks={[{
                  id: truck.id, unitNumber: truck.unitNumber, lat: truck.lat, lng: truck.lng, heading: truck.heading ?? 0, speedKmh: truck.speedKmh ?? 0,
                  status: truck.status, driverName: truck.driver?.name, moving: (truck.speedKmh ?? 0) > 1, stale,
                  label: active ? `${active.reference}: ${active.originCity} → ${active.destCity}` : "Idle",
                  route: active?.status === "IN_TRANSIT" ? loadRoute(active) : undefined,
                }]} />
              </div>
            </Card>

            <Card title="Notes" flush>
              {editable && (
                <ActionForm action={addTruckNote.bind(null, id)} resetOnSuccess className="border-b border-line p-3">
                  <div className="flex items-start gap-2">
                    <Textarea name="note" rows={1} required aria-label="New note" placeholder="Add a note — tyre change, damage, tolls tag, anything the next shift should know" className="min-h-8 flex-1 resize-y" />
                    <SubmitButton size="md" variant="secondary" pendingText="Adding…">Add note</SubmitButton>
                  </div>
                </ActionForm>
              )}
              <NotesList notes={truck.notes} />
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Assignment">
              <div className="space-y-4">
                <div>
                  <p className="eyebrow mb-1">Driver</p>
                  {truck.driver ? (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/drivers/${truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{truck.driver.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge value={truck.driver.boardStatus} label={BOARD_STATUS_LABELS[truck.driver.boardStatus as BoardStatus] ?? truck.driver.boardStatus} />
                          {truck.driver.hold && <Chip tone="warn">Hold</Chip>}
                        </div>
                      </div>
                      {truck.driver.phone && <a href={`tel:${truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                    </div>
                  ) : (
                    <p className="text-[13px] text-fg-muted">Unassigned{editable && <> · <Link href={`/fleet/${id}/edit`} className="text-fg hover:underline">assign a driver</Link></>}</p>
                  )}
                </div>
                <div>
                  <p className="eyebrow mb-1">Current load</p>
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
                      {active.status === "ASSIGNED" && <p className="mt-1 text-[11px] text-info">Awaiting pickup · {dateTime(active.pickupAt)}</p>}
                    </div>
                  ) : <p className="text-[13px] text-fg-muted">{truck.status === "ACTIVE" ? "Idle — available for dispatch" : `Not dispatchable while ${TRUCK_STATUS_LABELS[truck.status].toLowerCase()}`}</p>}
                </div>
                <div>
                  <p className="eyebrow mb-1">Paired trailers</p>
                  {truck.trailers.length === 0 ? <p className="text-[13px] text-fg-muted">None paired</p> : (
                    <ul className="space-y-1">
                      {truck.trailers.map((tr) => (
                        <li key={tr.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <Link href={`/fleet/trailers/${tr.id}`} className="num font-medium text-fg hover:underline">{tr.unitNumber}</Link>
                          <span className="flex items-center gap-2 text-[11px] text-fg-subtle">{tr.type.replace("_", " ").toLowerCase()}<Badge value={tr.status} /></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Identity">
              <DL items={[
                ["Unit", <span key="u" className="num">{truck.unitNumber}</span>],
                ["Plate", <span key="p" className="num">{truck.plate}</span>],
                ["Vehicle", `${truck.year} ${truck.make} ${truck.model}`],
                ["VIN", <span key="v" className="num">{truck.vin ?? "—"}</span>],
                ["Ownership", lease ? `${OWNERSHIP_LABELS[truck.ownership]} · ${truck.lessor ?? "lessor n/a"}` : OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership],
                ["Group", truck.group ?? "—"],
                ["Odometer", <span key="o" className="num">{km(truck.odometerKm)}</span>],
                ["Fuel", `${fuelLabel} · ${number(truck.fuelCapacityL)} L tank`],
              ]} />
            </Card>

            <Card title="Service & paperwork" actions={<Link href={`/fleet/${id}?tab=compliance`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Compliance →</Link>}>
              <DL items={[
                ["Next PM", pm.left == null ? "—" : <span key="pm" className={cn("num", pm.tone === "danger" ? "text-danger" : pm.tone === "warn" ? "text-warn" : "")}>{pm.left < 0 ? `${number(-pm.left)} km overdue` : `in ${number(pm.left)} km`}</span>],
                ["Documents", <span key="d" className={cn("num", missing.length ? "text-warn" : "text-ok")}>{REQUIRED_UNIT_DOCS.length - missing.length}/{REQUIRED_UNIT_DOCS.length} on file</span>],
                ["Insurance", <ExpiryBadge key="i" days={daysUntil(paper.INSURANCE)} />],
                ["Inspection", <ExpiryBadge key="n" days={daysUntil(paper.INSPECTION)} />],
                ["Registration", <ExpiryBadge key="r" days={daysUntil(paper.REGISTRATION)} />],
                ["Lease cap", lease ? <span key="l" className={cn("num", lease.tone === "danger" ? "text-danger" : lease.tone === "warn" ? "text-warn" : "")}>{lease.overKm > 0 ? `${number(lease.overKm)} km over` : `${number(lease.remainingKm)} km left`}</span> : "—"],
              ]} />
            </Card>
          </div>
        </div>
      )}

      {tab === "maintenance" && <MaintenanceTab truck={truck} editable={editable} />}
      {tab === "specs" && (
        <Card title="Specifications">
          <DL cols={3} items={[
            ["VIN", <span key="v" className="num">{truck.vin ?? "—"}</span>],
            ["Year", <span key="y" className="num">{truck.year}</span>],
            ["Make", truck.make],
            ["Model", truck.model],
            ["Plate", <span key="p" className="num">{truck.plate}</span>],
            ["Fuel type", fuelLabel],
            ["Tank capacity", <span key="c" className="num">{number(truck.fuelCapacityL)} L</span>],
            ["PM interval", <span key="i" className="num">{km(truck.pmIntervalKm)}</span>],
            ["Odometer", <span key="o" className="num">{km(truck.odometerKm)}</span>],
            ["Ownership", OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership],
            ["Group", truck.group ?? "—"],
            ["Lessor", truck.lessor ?? "—"],
            ["Telematics source", pingSourceLabel(truck.pingSource)],
            ["Rolling fuel economy", truck.fuelEconomy ? <span key="fe" className="num">{truck.fuelEconomy.toFixed(1)} L/100km</span> : "—"],
            ["Added", date(truck.createdAt)],
          ]} />
        </Card>
      )}
      {tab === "financial" && <FinancialTab truck={truck} editable={editable} showRevenue={showRevenue} />}
      {tab === "compliance" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DocumentsPanel user={user} target={{ type: "truck", id }} path={`/fleet/${id}`} withExpiry required={[...REQUIRED_UNIT_DOCS]} />
          </div>
          <Card title={
            <span className="flex items-center gap-1.5">Required paperwork
              <InfoTip>Registration, insurance and technical inspection must be on file for every unit. Set an expiry when you upload so renewals surface as alerts.</InfoTip>
            </span>
          } flush>
            <Table dense stickyHead={false} head={["Document", "On file",
              <span key="exp" className="inline-flex items-center gap-1">Expires<InfoTip>The earlier of the date on the truck record and the newest uploaded file, so a stale record never hides an expired paper. Edit the record to change recorded dates.</InfoTip></span>]}>
              {REQUIRED_UNIT_DOCS.map((kind) => {
                const doc = docRows.find((d) => d.kind === kind);
                const recorded = truck[DOC_FIELD[kind]];
                const expiry = paper[kind];
                const fromRecord = expiry != null && recorded != null && expiry.getTime() !== doc?.expiresAt?.getTime();
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
                        {expiry && <span className="text-[11px] text-fg-subtle">{date(expiry)}{fromRecord ? " · from record" : ""}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}
      {tab === "loads" && <LoadsTab truckId={id} showRevenue={showRevenue} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Metric({ icon, label, value, unit, hint, tone = "neutral", small, bar }: {
  icon: React.ReactNode; label: string; value: string; unit?: string; hint?: string; tone?: Tone; small?: boolean; bar?: { value: number; tone: Tone };
}) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between"><span className="eyebrow">{label}</span><span className="text-fg-faint [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span></div>
      <p className={cn("mt-1 truncate font-semibold leading-tight", small ? "text-[13px]" : "num text-[18px]", color)} title={value}>
        {value}{unit && <span className="ml-0.5 text-[11px] font-medium text-fg-subtle">{unit}</span>}
      </p>
      {bar && <Progress value={bar.value} tone={bar.tone} className="mt-1.5" />}
      {hint && <p className="mt-1 truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

function NotesList({ notes }: { notes: string | null }) {
  const items = parseNotes(notes);
  if (items.length === 0) return <p className="px-4 py-5 text-center text-[12px] text-fg-muted">No notes yet. Anything worth telling the next shift goes here.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((n, i) => (
        <li key={i} className="px-4 py-2">
          <p className="text-[13px] text-fg">{n.text}</p>
          {(n.date || n.author) && <p className="mt-0.5 text-[11px] text-fg-subtle">{[n.author, n.date ? date(n.date) : null].filter(Boolean).join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}

async function MaintenanceTab({ truck, editable }: { truck: { id: string; odometerKm: number; pmIntervalKm: number; lastPmKm: number | null; lastPmAt: Date | null; nextServiceKm: number | null }; editable: boolean }) {
  const workOrders = await db.workOrder.findMany({ where: { truckId: truck.id }, orderBy: [{ status: "asc" }, { scheduledAt: "desc" }], take: 60, include: { createdBy: { select: { name: true } } } });
  const pm = pmStatus(truck);
  const open = workOrders.filter((w) => ["OPEN", "IN_PROGRESS", "DRAFT"].includes(w.status));
  const done = workOrders.filter((w) => w.status === "DONE");
  const spend12 = done.filter((w) => w.completedAt && w.completedAt >= daysAgo(365)).reduce((a, w) => a + w.cost, 0);
  const sorted = [...open.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()), ...workOrders.filter((w) => !open.includes(w))];
  const inShopDays = (w: { inAt: Date | null; outAt: Date | null }) => w.inAt ? Math.max(0, Math.round(((w.outAt ?? new Date()).getTime() - w.inAt.getTime()) / 86_400_000)) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Card title="Work orders" flush actions={<span className="text-[11px] text-fg-subtle"><span className="num">{open.length}</span> open · <span className="num">{done.length}</span> completed · <span className="num">{money(spend12)}</span> last 12 months</span>}>
          <Table head={["#", "Work", "Category", "Priority", "Vendor", "Scheduled", "In shop", "Cost", "Status", ""]}>
            {sorted.map((w) => {
              const days = inShopDays(w);
              return (
                <tr key={w.id} className={w.status === "CANCELLED" ? "opacity-60" : undefined}>
                  <td><Link href={`/maintenance/work-orders/${w.id}`} className="num font-medium hover:underline">#{w.number}</Link></td>
                  <td className="max-w-64 truncate text-fg" title={w.odometerKm != null ? `${w.title} · at ${km(w.odometerKm)}` : w.title}>{w.title}</td>
                  <td className="whitespace-nowrap text-fg-muted">{WORK_ORDER_CATEGORY_LABELS[w.category] ?? w.category}</td>
                  <td>{w.priority !== "MEDIUM" ? <Badge value={w.priority} /> : <span className="text-fg-subtle">Medium</span>}</td>
                  <td className="max-w-36 truncate text-fg-muted">{w.vendor ?? "—"}</td>
                  <td className="whitespace-nowrap text-fg-muted">{date(w.scheduledAt)}</td>
                  <td className="whitespace-nowrap text-fg-muted">{days == null ? "—" : <span className="num">{days}d{!w.outAt && w.status === "IN_PROGRESS" ? " so far" : ""}</span>}</td>
                  <td className="num whitespace-nowrap">{w.cost ? money(w.cost) : <span className="text-fg-faint">—</span>}</td>
                  <td><Badge value={w.status} dot /></td>
                  <td className="text-right">{editable && <WorkOrderActions id={w.id} status={w.status} />}</td>
                </tr>
              );
            })}
          </Table>
          {workOrders.length === 0 && <EmptyState title="No work orders" description={editable ? "Create one on the right — PM services, repairs and inspections all live here." : "PM services, repairs and inspections will appear here."} />}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={<span className="flex items-center gap-1.5">PM schedule<InfoTip>Completing a PM work order resets the last PM and schedules the next one automatically.</InfoTip></span>}>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <p className="eyebrow">{pm.state === "overdue" ? "Overdue by" : "Kilometres left"}</p>
              <p className={cn("num mt-1 text-[22px] font-semibold leading-none", pm.tone === "danger" ? "text-danger" : pm.tone === "warn" ? "text-warn" : "text-fg")}>
                {pm.left == null ? "—" : `${number(Math.abs(pm.left))} km`}
              </p>
            </div>
            {pm.state !== "unknown" && <Badge value={pm.state === "overdue" ? "OVERDUE" : pm.state === "due" ? "HIGH" : "DONE"} label={pm.state === "overdue" ? "Overdue" : pm.state === "due" ? "Due soon" : "On schedule"} />}
          </div>
          {pm.pct != null && <Progress value={pm.pct} tone={pm.tone} className="mb-3" />}
          <DL items={[
            ["Last PM", truck.lastPmKm != null ? <span key="l" className="num">{km(truck.lastPmKm)}</span> : "—"],
            ["Last PM date", date(truck.lastPmAt)],
            ["Interval", <span key="i" className="num">{km(truck.pmIntervalKm)}</span>],
            ["Next service", pm.next != null ? <span key="n" className="num">{km(pm.next)}</span> : "—"],
            ["Odometer", <span key="o" className="num">{km(truck.odometerKm)}</span>],
          ]} />
        </Card>

        {editable && (
          <Card id="new-work-order" className="scroll-mt-20"
            title={<span className="flex items-center gap-1.5">New work order<InfoTip>Starting it now moves the truck to In shop; Done records work that is already completed.</InfoTip></span>}>
            <ActionForm action={saveMaintenance} resetOnSuccess className="space-y-3">
              <input type="hidden" name="truckId" value={truck.id} />
              <Field label="Category"><Select name="type" options={WORK_ORDER_CATEGORIES.map((c) => ({ value: c, label: WORK_ORDER_CATEGORY_LABELS[c] }))} /></Field>
              <Field label="What needs doing" required><Input name="description" required placeholder="Replace front brake pads" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date"><Input name="scheduledAt" type="date" defaultValue={toDateInput(new Date())} /></Field>
                <Field label="Estimated cost"><Input name="cost" type="number" min={0} step="0.01" placeholder="0" className="num" /></Field>
                <Field label="Odometer (km)"><Input name="odometerKm" type="number" min={0} defaultValue={truck.odometerKm} className="num" /></Field>
                <Field label="Vendor"><Input name="vendor" placeholder="UzTruck Service" /></Field>
              </div>
              <Field label="Start as">
                <Select name="status" options={[{ value: "OPEN", label: "Open — scheduled" }, { value: "IN_PROGRESS", label: "In progress — unit is in the shop" }, { value: "DONE", label: "Done — already completed" }]} />
              </Field>
              <SubmitButton className="w-full" pendingText="Creating…">Create work order</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}

async function FinancialTab({ truck, editable, showRevenue }: {
  truck: { id: string; odometerKm: number; ownership: string; lessor: string | null; leaseStartKm: number | null; leaseAnnualLimitKm: number | null; leaseBufferPct: number | null; leaseOverageRate: number | null };
  editable: boolean; showRevenue: boolean;
}) {
  const since = daysAgo(90);
  const from6 = startOfMonth(subMonths(new Date(), 5));
  const [loads, fuel, wos, fuelLogs] = await Promise.all([
    db.load.findMany({ where: { truckId: truck.id, status: { in: COMPLETED_LOAD_STATUSES }, deliveredAt: { gte: from6 } }, select: { rate: true, driverPay: true, distanceKm: true, emptyKm: true, deliveredAt: true } }),
    db.fuelLog.findMany({ where: { truckId: truck.id, date: { gte: from6 } }, select: { cost: true, liters: true, date: true } }),
    db.workOrder.findMany({ where: { truckId: truck.id, status: "DONE", completedAt: { gte: from6 } }, select: { cost: true, completedAt: true } }),
    db.fuelLog.findMany({ where: { truckId: truck.id }, orderBy: { date: "desc" }, take: 12, include: { driver: { select: { name: true } } } }),
  ]);

  const in90 = <T extends { d: Date | null }>(xs: T[]) => xs.filter((x) => x.d && x.d >= since);
  const l90 = in90(loads.map((l) => ({ ...l, d: l.deliveredAt })));
  const f90 = in90(fuel.map((f) => ({ ...f, d: f.date })));
  const w90 = in90(wos.map((w) => ({ ...w, d: w.completedAt })));
  const revenue = l90.reduce((a, l) => a + l.rate, 0);
  const pay = l90.reduce((a, l) => a + l.driverPay, 0);
  const loaded = l90.reduce((a, l) => a + l.distanceKm, 0);
  const empty = l90.reduce((a, l) => a + l.emptyKm, 0);
  const totalKm = loaded + empty;
  const fuelCost = f90.reduce((a, f) => a + f.cost, 0);
  const liters = f90.reduce((a, f) => a + f.liters, 0);
  const woCost = w90.reduce((a, w) => a + w.cost, 0);
  const costPerKm = totalKm ? (fuelCost + woCost) / totalKm : null;
  const revPerKm = totalKm ? revenue / totalKm : null;
  const l100 = totalKm && liters ? (liters / totalKm) * 100 : null;
  const margin = revenue - pay - fuelCost - woCost;

  const months = Array.from({ length: 6 }, (_, i) => format(subMonths(new Date(), 5 - i), "MMM yy"));
  const rows = months.map((month) => ({ month, loads: 0, km: 0, revenue: 0, pay: 0, fuel: 0, wo: 0 }));
  const at = (d: Date | null) => (d ? rows.find((r) => r.month === format(d, "MMM yy")) : undefined);
  for (const l of loads) { const r = at(l.deliveredAt); if (r) { r.loads++; r.km += l.distanceKm + l.emptyKm; r.revenue += l.rate; r.pay += l.driverPay; } }
  for (const f of fuel) { const r = at(f.date); if (r) r.fuel += f.cost; }
  for (const w of wos) { const r = at(w.completedAt); if (r) r.wo += w.cost; }
  const totals = rows.reduce((a, r) => ({ loads: a.loads + r.loads, km: a.km + r.km, revenue: a.revenue + r.revenue, pay: a.pay + r.pay, fuel: a.fuel + r.fuel, wo: a.wo + r.wo }), { loads: 0, km: 0, revenue: 0, pay: 0, fuel: 0, wo: 0 });
  const lease = leaseStatus(truck);

  return (
    <div className="space-y-4">
      <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", showRevenue ? "xl:grid-cols-6" : "xl:grid-cols-4")}>
        {showRevenue && <Stat label="Revenue (90d)" value={money(revenue)} hint={`${l90.length} loads delivered`} tone="ok" spark={<Spark data={rows.map((r) => r.revenue)} tone="ok" />} />}
        <Stat label="Distance (90d)" value={km(totalKm)} hint={`${km(loaded)} loaded · ${totalKm ? Math.round((empty / totalKm) * 100) : 0}% empty`} />
        <Stat label="Fuel (90d)" value={money(fuelCost)} hint={l100 ? `${number(Math.round(liters))} L · ${l100.toFixed(1)} L/100km` : `${number(Math.round(liters))} L logged`} tone="warn" />
        <Stat label="Work orders (90d)" value={money(woCost)} hint={`${w90.length} completed`} tone={woCost ? "danger" : "neutral"} />
        <Stat label="Cost per km" value={costPerKm == null ? "—" : money2(costPerKm)} hint="fuel + work orders" />
        {showRevenue && <Stat label="Revenue per km" value={revPerKm == null ? "—" : money2(revPerKm)} hint={margin >= 0 ? `${money(margin)} margin after driver pay` : `${money(-margin)} loss after driver pay`} tone={margin >= 0 ? "ok" : "danger"} />}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={<span className="flex items-center gap-1.5">Last 6 months<InfoTip>Delivered loads by delivery month; fuel and work orders by the date they were logged or completed.</InfoTip></span>} flush>
            <Table dense stickyHead={false} head={["Month", "Loads", "Distance", ...(showRevenue ? ["Revenue", "Driver pay"] : []), "Fuel", "Work orders", ...(showRevenue ? ["Margin", "Rev/km"] : ["Cost/km"])]}>
              {rows.map((r) => {
                const m = r.revenue - r.pay - r.fuel - r.wo;
                return (
                  <tr key={r.month} className={r.loads === 0 && !r.fuel && !r.wo ? "text-fg-subtle" : undefined}>
                    <td className="font-medium text-fg">{r.month}</td>
                    <td className="num">{r.loads}</td>
                    <td className="num">{km(Math.round(r.km))}</td>
                    {showRevenue && <><td className="num">{money(r.revenue)}</td><td className="num text-fg-muted">{money(r.pay)}</td></>}
                    <td className="num text-fg-muted">{money(r.fuel)}</td>
                    <td className="num text-fg-muted">{money(r.wo)}</td>
                    {showRevenue
                      ? <><td className={cn("num font-medium", m < 0 ? "text-danger" : "")}>{money(m)}</td><td className="num">{r.km ? money2(r.revenue / r.km) : "—"}</td></>
                      : <td className="num">{r.km ? money2((r.fuel + r.wo) / r.km) : "—"}</td>}
                  </tr>
                );
              })}
              <tr className="bg-sunken/60 font-medium">
                <td>Total</td>
                <td className="num">{totals.loads}</td>
                <td className="num">{km(Math.round(totals.km))}</td>
                {showRevenue && <><td className="num">{money(totals.revenue)}</td><td className="num">{money(totals.pay)}</td></>}
                <td className="num">{money(totals.fuel)}</td>
                <td className="num">{money(totals.wo)}</td>
                {showRevenue
                  ? <><td className={cn("num", totals.revenue - totals.pay - totals.fuel - totals.wo < 0 ? "text-danger" : "")}>{money(totals.revenue - totals.pay - totals.fuel - totals.wo)}</td><td className="num">{totals.km ? money2(totals.revenue / totals.km) : "—"}</td></>
                  : <td className="num">{totals.km ? money2((totals.fuel + totals.wo) / totals.km) : "—"}</td>}
              </tr>
            </Table>
          </Card>

          <Card title="Fuel log" flush actions={<span className="text-[11px] text-fg-subtle">Last 12 fills</span>}>
            <Table dense stickyHead={false} head={["Date", "Station", "Liters", "Cost", "$/L", "Odometer", "Driver"]}>
              {fuelLogs.map((f) => (
                <tr key={f.id}>
                  <td className="whitespace-nowrap text-fg-muted">{date(f.date)}</td>
                  <td className="max-w-40 truncate">{f.station ?? "—"}</td>
                  <td className="num">{number(Math.round(f.liters))} L</td>
                  <td className="num">{money2(f.cost)}</td>
                  <td className="num text-fg-muted">{f.liters ? money2(f.cost / f.liters) : "—"}</td>
                  <td className="num text-fg-muted">{f.odometerKm ? km(f.odometerKm) : "—"}</td>
                  <td className="text-fg-muted">{f.driver?.name ?? "—"}</td>
                </tr>
              ))}
            </Table>
            {fuelLogs.length === 0 && <EmptyState title="No fuel logged" description={editable ? "Drivers log fills from the portal; you can add one on the right." : "Drivers log fills from the portal."} />}
          </Card>
        </div>

        <div className="space-y-4">
          {lease && (
            <Card title="Lease mileage control" actions={<Badge value={lease.state === "over" ? "OVERDUE" : lease.state === "ok" ? "DONE" : "HIGH"} label={lease.state === "over" ? "Over cap" : lease.state === "buffer" ? "In buffer" : lease.state === "near" ? "Near cap" : "Within limit"} />}>
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <p className="eyebrow">{lease.overKm > 0 ? "Over hard cap" : "Remaining to hard cap"}</p>
                  <p className={cn("num mt-1 text-[22px] font-semibold leading-none", lease.tone === "danger" ? "text-danger" : lease.tone === "warn" ? "text-warn" : "text-fg")}>{number(lease.overKm > 0 ? lease.overKm : lease.remainingKm)} km</p>
                </div>
                <div className="text-right">
                  <p className="eyebrow">Exposure</p>
                  <p className={cn("num mt-1 text-[18px] font-semibold leading-none", lease.exposure > 0 ? "text-danger" : "text-fg-muted")}>{money(lease.exposure)}</p>
                </div>
              </div>
              <Progress value={lease.pct} tone={lease.tone} marker={lease.allowedMarker} className="mb-1" />
              <div className="mb-3 flex justify-between text-[10px] text-fg-subtle"><span>start</span><span>limit</span><span>hard cap</span></div>
              <DL items={[
                ["Lessor", lease.lessor ?? "—"],
                ["Lease start", <span key="s" className="num">{km(lease.startKm)}</span>],
                ["Annual limit", <span key="a" className="num">{km(lease.limitKm)}</span>],
                ["Buffer", <span key="b" className="num">{lease.bufferPct}%</span>],
                ["Allowed", <span key="al" className="num">{km(lease.allowedKm)}</span>],
                ["Hard cap", <span key="h" className="num">{km(lease.hardCapKm)}</span>],
                ["Current", <span key="c" className="num">{km(truck.odometerKm)}</span>],
                ["Overage rate", <span key="r" className="num">{money2(lease.rate)}/km</span>],
              ]} />
            </Card>
          )}

          {editable && (
            <Card title={<span className="flex items-center gap-1.5">Log fuel<InfoTip>An odometer reading higher than the truck&apos;s updates it.</InfoTip></span>}>
              <ActionForm action={addFuelLog.bind(null, truck.id)} resetOnSuccess className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Liters" required><Input name="liters" type="number" step="0.1" min={0} required className="num" /></Field>
                  <Field label="Cost (USD)" required><Input name="cost" type="number" step="0.01" min={0} required className="num" /></Field>
                  <Field label="Odometer (km)"><Input name="odometerKm" type="number" min={0} placeholder={String(truck.odometerKm)} className="num" /></Field>
                  <Field label="Station"><Input name="station" placeholder="UNG Tashkent ring road" /></Field>
                </div>
                <SubmitButton variant="secondary" className="w-full" pendingText="Logging…">Add fuel entry</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

async function LoadsTab({ truckId, showRevenue }: { truckId: string; showRevenue: boolean }) {
  const loads = await db.load.findMany({
    where: { truckId }, orderBy: { pickupAt: "desc" }, take: 60,
    include: { customer: { select: { name: true } }, driver: { select: { id: true, name: true } }, trailer: { select: { id: true, unitNumber: true } } },
  });
  const delivered = loads.filter((l) => l.deliveredAt);
  const onTime = delivered.filter((l) => l.deliveredAt! <= l.deliveryAt).length;
  return (
    <Card title="Load history" flush actions={
      <span className="text-[11px] text-fg-subtle">
        <span className="num">{loads.length}</span> loads{delivered.length > 0 && <> · <span className="num">{Math.round((onTime / delivered.length) * 100)}%</span> on time</>}
      </span>
    }>
      <Table head={["Load", "Status", "Route", "Customer", "Driver", "Trailer", "Pickup", "Delivered",
        <span key="km" className="inline-flex items-center gap-1">Distance<InfoTip>Loaded km, plus empty repositioning km where recorded.</InfoTip></span>,
        ...(showRevenue ? ["Rate", "Rate/km"] : [])]}>
        {loads.map((l) => (
          <tr key={l.id}>
            <td><Link href={`/loads/${l.id}`} className="num font-medium hover:underline">{l.reference}</Link></td>
            <td><Badge value={l.status} label={LOAD_STATUS_LABELS[l.status as LoadStatus]} /></td>
            <td className="whitespace-nowrap">{l.originCity} → {l.destCity}</td>
            <td className="max-w-40 truncate text-fg-muted">{l.customer.name}</td>
            <td className="whitespace-nowrap">{l.driver ? <Link href={`/drivers/${l.driver.id}`} className="hover:underline">{l.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
            <td>{l.trailer ? <Link href={`/fleet/trailers/${l.trailer.id}`} className="num hover:underline">{l.trailer.unitNumber}</Link> : <span className="text-fg-faint">—</span>}</td>
            <td className="whitespace-nowrap text-fg-muted">{dateTime(l.pickupAt)}</td>
            <td className={cn("whitespace-nowrap", l.deliveredAt && l.deliveredAt > l.deliveryAt ? "text-danger" : "text-fg-muted")}>{l.deliveredAt ? dateTime(l.deliveredAt) : "—"}</td>
            <td className="num whitespace-nowrap">{km(l.distanceKm)}{l.emptyKm > 0 && <span className="text-fg-subtle"> +{number(l.emptyKm)}</span>}</td>
            {showRevenue && <><td className="num">{money(l.rate)}</td><td className="num text-fg-muted">{l.distanceKm ? money2(l.rate / l.distanceKm) : "—"}</td></>}
          </tr>
        ))}
      </Table>
      {loads.length === 0 && <EmptyState title="No loads yet" description="Assign this truck from the dispatch board or a load page and its history will build up here." action={<LinkButton href="/loads" variant="secondary">Open loads</LinkButton>} />}
    </Card>
  );
}
