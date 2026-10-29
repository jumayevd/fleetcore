import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { CalendarClock, ChevronRight, Compass, Droplet, Fuel, Gauge, MapPin, Pencil, Phone, Power, Radio, Route, Wrench } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CITIES, DEFECT_SEVERITY_LABELS, DRIVER_TYPE_LABELS, EQUIPMENT_LABELS, OWNERSHIP_LABELS, REPAIR_STAGE_LABELS } from "@/lib/constants";
import { DOC_KIND_LABELS, REQUIRED_UNIT_DOCS, UNIT_DOC_SLOTS } from "@/lib/documents";
import { ago, daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { daysToCover, distancePerDay, kmDriven } from "@/lib/mileage";
import { eldByTruck } from "@/lib/eld/sync";
import { roLabel, SERVICE_STATE_LABELS, serviceStatus, STALE_READING_DAYS, type ServiceStatus } from "@/lib/service";
import { addTruckNote, updateTruckReadings } from "@/app/actions/fleet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, Chip, DL, Field, InfoTip, Input, LinkButton, PageHeader, Progress, Stat, StatusDot, Tabs, Textarea, cn, type Tone } from "@/components/ui";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { UnitRepairs } from "@/components/fleet/unit-repairs";
import { UnitDefects } from "@/components/fleet/unit-defects";
import { VehicleCondition } from "@/components/fleet/vehicle-condition";
import { ServiceSchedule } from "@/components/fleet/service-schedule";
import { UnitSafetyHistory } from "@/components/fleet/unit-safety";
import { TruckStatusMenu } from "./status-menu";
import { CompletenessCard, FixLink, FixNote, TruckFix, type Prompt } from "./complete";
import { ExpensesTab } from "./expenses";
import { DriverTab } from "./driver-tab";
import { CompletedRepairs } from "../repair-history";
import { openDefects, openRepairs, truckTypeOptions, type OpenRepair } from "../data";
import {
  compass, dayAsDate, daysSince, docExpiryByUnit, earliest, EXPIRY_SOON_DAYS, FUEL_TYPE_LABELS, fuelTone, intervalText, leaseStatus, missingDocs,
  ODOMETER_JUMP_KM, OWNERSHIP_TONE, parseNotes, pingSourceLabel, pingStale, recordedExpiry, serviceSummary, truckStatusLabel, truckStatusTone, type ServiceSummary,
} from "../lib";

const TABS = ["overview", "driver", "maintenance", "expenses", "history", "documents", "specs", "notes"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview", driver: "Driver", maintenance: "Maintenance", expenses: "Expenses", history: "History", documents: "Documents", specs: "Specs", notes: "Notes",
};
/** Links made before the tabs were renamed still land on the right tab. */
const TAB_ALIASES: Record<string, Tab> = { financial: "expenses", costs: "expenses", compliance: "documents" };
const DAY = 86_400_000;

const TRUCK_INCLUDE = {
  driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true, status: true, type: true, dispatcher: true } },
  trailers: { select: { id: true, unitNumber: true, type: true, status: true }, orderBy: { unitNumber: "asc" } },
  truckType: { select: { id: true, name: true, oilIntervalKm: true } },
} satisfies Prisma.TruckInclude;

export async function generateMetadata({ params }: PageProps<"/fleet/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.truck.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: r?.unitNumber ?? "Not found" };
}

export default async function TruckDetail({ params, searchParams }: PageProps<"/fleet/[id]">) {
  const user = await requireUser("fleet.view");
  const f = await getFormat();
  const { id } = await params;
  const sp = await searchParams;
  const tabParam = String(sp.tab);
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : TAB_ALIASES[tabParam] ?? "overview";
  const editable = can(user.role, "fleet.edit");
  const showMoney = can(user.role, "money.view");

  const truck = await db.truck.findUnique({ where: { id }, include: TRUCK_INCLUDE });
  if (!truck) notFound();

  const now = new Date();
  const [docRows, repairs, defects, perDay, types] = await Promise.all([
    db.document.findMany({ where: { truckId: id, kind: { in: [...UNIT_DOC_SLOTS.truck] } }, orderBy: { createdAt: "desc" }, select: { kind: true, expiresAt: true } }),
    openRepairs("truck", [id]),
    openDefects("truck", [id]),
    distancePerDay([id]),
    truckTypeOptions(),
  ]);
  const repair = repairs.get(id);
  const defect = defects.get(id);
  const have = new Set(docRows.map((d) => d.kind));
  const missing = missingDocs(have, REQUIRED_UNIT_DOCS);
  const recorded = recordedExpiry(truck);
  const files = docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id);
  // Earlier of the record date and the newest file's expiry, so a stale record can't hide an expired paper.
  const paper = UNIT_DOC_SLOTS.truck.map((k) => ({ kind: k, expiry: earliest(files?.get(k), recorded[k as keyof typeof recorded]) })).filter((p) => p.expiry);
  const s = serviceStatus(truck, now);
  const days = daysToCover(s.left, perDay.get(id));
  const svc = serviceSummary(s, f, days);
  const lease = leaseStatus(truck);
  const notes = parseNotes(truck.notes);
  const docsHref = `/fleet/${id}?tab=documents`;
  const maintHref = `/fleet/${id}?tab=maintenance`;

  // What the rest of the app needs from this record, each with its one-click fix.
  const prompts: Prompt[] = [];
  if (!have.has("REGISTRATION")) {
    prompts.push({ key: "reg", text: "No registration on file", hint: "DOT inspectors and the paperwork alerts look for it.",
      fix: editable ? <FixLink href={`${docsHref}#doc-REGISTRATION`}>Attach</FixLink> : <FixNote href={docsHref}>See documents</FixNote> });
  }
  if (!truck.plate.trim()) {
    prompts.push({ key: "plate", text: "Add the plate", fix: editable ? <TruckFix truckId={id} field="plate" f={f} /> : undefined });
  }
  if (!truck.inServiceAt) {
    prompts.push({ key: "service-date", text: "Add the in-service date", hint: "Starts the truck's service history and its age.",
      fix: editable ? <TruckFix truckId={id} field="inServiceAt" f={f} /> : undefined });
  }
  if (!truck.truckTypeId) {
    prompts.push({
      key: "type", text: "No truck type: set the oil interval",
      hint: `Until then the truck's own interval applies (${f.dist(truck.pmIntervalKm)}).`,
      fix: !editable ? undefined : types.length
        ? <TruckFix truckId={id} field="truckTypeId" types={types} f={f} />
        : <FixLink href={`/fleet/${id}/edit#service`}>Set the oil interval</FixLink>,
    });
  }
  if (s.stale && truck.status !== "INACTIVE") {
    prompts.push({
      key: "reading", text: truck.odometerAt ? `Odometer last read ${f.date(truck.odometerAt)}` : "The odometer reading has no date",
      hint: `Older than ${STALE_READING_DAYS} days, the oil countdown is only a lower bound.`,
      fix: editable ? <FixLink href="#readings">Update readings</FixLink> : undefined,
    });
  }

  // Exceptions on this unit — the triage list a fleet specialist reads first.
  const attention: { tone: Tone; text: string; href: string }[] = [];
  if (defect?.holds) attention.push({ tone: "danger", text: "A defect keeps this truck out of service until the repair is verified", href: maintHref });
  else if (defect?.urgent) attention.push({ tone: "danger", text: `${defect.urgent} defect${defect.urgent > 1 ? "s" : ""} to fix before the next load`, href: maintHref });
  if (s.state === "overdue") attention.push({ tone: "danger", text: `Oil service overdue by ${f.dist(-(s.left ?? 0))}${s.stale ? " (at least)" : ""}`, href: "#service" });
  else if (s.state === "due_now" || s.state === "due_soon") attention.push({ tone: s.state === "due_now" ? "warn" : "info", text: `Oil service due in ${svc.text}`, href: "#service" });
  if (lease?.state === "over") attention.push({ tone: "danger", text: `${f.dist(lease.overKm)} over the lease cap${showMoney ? ` · ${f.money(lease.exposure)} exposure` : ""}`, href: `/fleet/${id}?tab=expenses` });
  else if (lease && lease.state !== "ok") attention.push({ tone: "warn", text: `${f.dist(lease.remainingKm)} left before the lease hard cap`, href: `/fleet/${id}?tab=expenses` });
  for (const p of paper) {
    const d = daysUntil(p.expiry);
    const href = `${docsHref}#doc-${p.kind}`;
    if (d != null && d < 0) attention.push({ tone: "danger", text: `${DOC_KIND_LABELS[p.kind]} expired ${-d}d ago`, href });
    else if (d != null && d <= EXPIRY_SOON_DAYS) attention.push({ tone: "warn", text: `${DOC_KIND_LABELS[p.kind]} expires in ${d}d`, href });
  }
  const missingOther = missing.filter((k) => k !== "REGISTRATION"); // registration is in the prompts above
  if (missingOther.length) attention.push({ tone: "warn", text: `Not on file: ${missingOther.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")}`, href: docsHref });
  if (truck.status === "ACTIVE" && !truck.driver) attention.push({ tone: "info", text: "No driver assigned", href: `/fleet/${id}?tab=driver` });
  if (truck.driver?.hold) attention.push({ tone: "warn", text: `${truck.driver.name} is on hold${truck.driver.holdReason ? `: ${truck.driver.holdReason}` : ""}`, href: `/drivers/${truck.driver.id}` });
  if ((truck.status === "MAINTENANCE" || truck.status === "VENDOR") && !repair) attention.push({ tone: "info", text: `${truck.status === "VENDOR" ? "At a vendor" : "In maintenance"} with no open repair order`, href: editable ? `/maintenance/work-orders/new?truck=${id}` : maintHref });

  const openWork = (repair?.count ?? 0) + (defect?.open ?? 0);
  const tabs = TABS.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/fleet/${id}${t === "overview" ? "" : `?tab=${t}`}`,
    count: t === "maintenance" ? openWork || undefined : t === "documents" ? missing.length || undefined : t === "notes" ? notes.length || undefined : undefined,
  }));

  return (
    <>
      <PageHeader
        title={<span className="num">{truck.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!editable && <Badge value={truckStatusTone(truck.status, Boolean(truck.driverId))} label={truckStatusLabel(truck.status, Boolean(truck.driverId))} dot />}
            <span>{truck.year} {truck.make} {truck.model}</span>
            {truck.truckType && <Chip className="normal-case tracking-normal">{truck.truckType.name}</Chip>}
            <Chip tone={OWNERSHIP_TONE[truck.ownership]} className="normal-case tracking-normal">{OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership}</Chip>
            {truck.plate && <span>Plate <span className="num text-fg">{truck.plate}</span></span>}
            <InfoTip>VIN {truck.vin ?? "not recorded"}{truck.homeTerminal ? ` · ${truck.homeTerminal}` : truck.group ? ` · ${truck.group}` : ""}</InfoTip>
          </span>
        }
        actions={editable && (
          <>
            <TruckStatusMenu id={id} status={truck.status} hasDriver={Boolean(truck.driverId)} />
            <LinkButton href={`/fleet/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
            <LinkButton href={`/maintenance/oil?book=${id}`} variant="secondary"><CalendarClock />Schedule maintenance</LinkButton>
            <LinkButton href={`/maintenance/work-orders/new?truck=${id}`}><Wrench />Create repair</LinkButton>
          </>
        )}
      />

      <Tabs active={tab} tabs={tabs} />

      {tab === "overview" && (
        <OverviewTab truck={truck} now={now} editable={editable} showMoney={showMoney} prompts={prompts} attention={attention} svc={svc} s={s} days={days} repair={repair} />
      )}

      {tab === "driver" && <DriverTab truckId={id} unit={truck.unitNumber} editable={editable} />}

      {tab === "maintenance" && (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-subtle">
            <span>
              {repair ? <>Open: <Link href={`/maintenance/work-orders/${repair.id}`} className="num font-medium text-fg hover:underline">{roLabel(repair.number)}</Link> · {repair.status === "IN_PROGRESS" ? (repair.stage ? REPAIR_STAGE_LABELS[repair.stage] ?? repair.stage : "in the shop") : `scheduled ${f.day(repair.scheduledAt)}`}{repair.count > 1 ? ` · ${repair.count - 1} more open` : ""}</> : "No open repair order"}
            </span>
            {defect && <span>{defect.open} open defect{defect.open === 1 ? "" : "s"}{defect.urgent ? `, ${defect.urgent} ${DEFECT_SEVERITY_LABELS.NOW.toLowerCase()}` : ""}</span>}
            <Link href={`/maintenance/work-orders?unit=${id}&status=all`} className="font-medium text-fg-muted hover:text-fg">All repairs for {truck.unitNumber} →</Link>
          </p>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <UnitRepairs unit={{ type: "truck", id }} editable={editable} />
              <UnitDefects unit={{ type: "truck", id }} editable={editable} />
            </div>
            <div className="space-y-4">
              <ServiceSchedule truckId={id} editable={editable} />
              <VehicleCondition truckId={id} />
            </div>
          </div>
        </div>
      )}

      {tab === "expenses" && <ExpensesTab truck={truck} editable={editable} showMoney={showMoney} />}

      {tab === "history" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <CompletedRepairs unit={{ type: "truck", id }} showMoney={showMoney} />
          <div className="space-y-4">
            <UnitSafetyHistory unit={{ type: "truck", id }} />
          </div>
        </div>
      )}

      {tab === "documents" && (
        <DocumentsPanel user={user} target={{ type: "truck", id }} path={`/fleet/${id}`} required={[...REQUIRED_UNIT_DOCS]} recorded={recorded}
          description="One slot per paper. Upload the newest copy with its dates; Replace keeps the earlier file under the slot." />
      )}

      {tab === "specs" && (
        <Card title="Specifications" actions={editable && <LinkButton href={`/fleet/${id}/edit`} variant="secondary" size="sm"><Pencil />Edit</LinkButton>}>
          <DL cols={3} items={[
            ["Unit", <span key="u" className="num">{truck.unitNumber}</span>],
            ["VIN", <span key="v" className="num">{truck.vin ?? "—"}</span>],
            ["Plate", <span key="p" className="num">{truck.plate || "—"}</span>],
            ["Year", <span key="y" className="num">{truck.year}</span>],
            ["Make", truck.make],
            ["Model", truck.model],
            ["Truck type", truck.truckType ? `${truck.truckType.name} · oil every ${f.dist(truck.truckType.oilIntervalKm)}` : "No type"],
            ["Colour", truck.color ?? "—"],
            ["In service since", f.date(truck.inServiceAt)],
            ["Home terminal", truck.homeTerminal ?? "—"],
            ["Group", truck.group ?? "—"],
            ["Ownership", OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership],
            ["Lessor", truck.lessor ?? "—"],
            ["Fuel type", FUEL_TYPE_LABELS[truck.fuelType] ?? truck.fuelType],
            ["Tank capacity", <span key="c" className="num">{f.number(truck.fuelCapacityL)} {f.labels.volume}</span>],
            ["Oil interval", <span key="i" className="num">{intervalText(s, f)}</span>],
            ["Odometer", <span key="o" className="num">{f.dist(truck.odometerKm)}{truck.odometerAt ? ` · ${f.date(truck.odometerAt)}` : ""}</span>],
            ["Engine hours", truck.engineHours != null ? <span key="h" className="num">{f.number(truck.engineHours)} h</span> : "—"],
            ["Rolling fuel economy", truck.fuelEconomy ? <span key="fe" className="num">{f.economyText(truck.fuelEconomy)}</span> : "—"],
            ["Position source", pingSourceLabel(truck.pingSource)],
            ["Added", f.date(truck.createdAt)],
          ]} />
        </Card>
      )}

      {tab === "notes" && (
        <Card title="Notes" flush className="max-w-3xl">
          {editable && (
            <ActionForm action={addTruckNote.bind(null, id)} resetOnSuccess className="border-b border-line p-3">
              <div className="flex items-start gap-2">
                <Textarea name="note" rows={2} required aria-label="New note" placeholder="Tire change, damage, toll tag, anything the next shift should know" className="min-h-8 flex-1 resize-y" />
                <SubmitButton size="md" variant="secondary" pendingText="Adding…">Add note</SubmitButton>
              </div>
            </ActionForm>
          )}
          {notes.length === 0 ? (
            <p className="px-4 py-5 text-center text-[12px] text-fg-muted">{editable ? "No notes yet. Anything the next shift should know about this truck goes here." : "No notes on this truck yet."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {notes.map((n, i) => (
                <li key={i} className="px-4 py-2">
                  <p className="text-[13px] text-fg">{n.text}</p>
                  {(n.date || n.author) && <p className="mt-0.5 text-[11px] text-fg-subtle">{[n.author, n.date ? f.date(dayAsDate(n.date)) : null].filter(Boolean).join(" · ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

type DetailTruck = Prisma.TruckGetPayload<{ include: typeof TRUCK_INCLUDE }>;

async function OverviewTab({ truck, now, editable, showMoney, prompts, attention, svc, s, days, repair }: {
  truck: DetailTruck; now: Date; editable: boolean; showMoney: boolean; prompts: Prompt[];
  attention: { tone: Tone; text: string; href: string }[];
  svc: ServiceSummary; s: ServiceStatus; days: number | null; repair: OpenRepair | undefined;
}) {
  const f = await getFormat();
  const id = truck.id;
  const lease = leaseStatus(truck);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const [spend, fuel90, driven90, repairs90, eldMap] = await Promise.all([
    showMoney
      ? db.workOrder.aggregate({ where: { truckId: id, status: "DONE", voidedAt: null, completedAt: { gte: since90 } }, _sum: { cost: true } })
      : Promise.resolve(null),
    db.fuelLog.aggregate({ where: { truckId: id, date: { gte: since90 } }, _sum: { liters: true } }),
    kmDriven(since90, now, [id]),
    db.workOrder.count({ where: { truckId: id, status: "DONE", voidedAt: null, completedAt: { gte: since90 } } }),
    eldByTruck([id]),
  ]);
  // What the ELD adds: distance driven by GPS since this reading (a lower bound), its driver and DEF level.
  const eld = eldMap.get(id) ?? null;
  const gps = eld && (eld.gpsFrom?.getTime() ?? null) === (truck.odometerAt?.getTime() ?? null) ? eld.gpsDistance : 0;
  const distance = driven90.byTruck.get(id) ?? 0;
  const economy = f.economy(distance, fuel90._sum.liters ?? 0);
  const stale = pingStale(truck.lastPingAt);
  const hasPosition = truck.lat != null && truck.lng != null;
  const readingAge = truck.odometerAt ? daysSince(truck.odometerAt) : null;
  const svcTone = svc.tone;
  const big = s.state === "overdue" ? f.dist(-(s.left ?? 0)) : s.left != null ? f.dist(s.left) : "—";
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <CompletenessCard prompts={prompts} unitLabel={truck.unitNumber} />

        <Card title="Needs attention" bodyClassName="p-0" actions={attention.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{attention.length}</span>}>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-fg-muted"><StatusDot tone="ok" />Nothing needs a look on this truck.</p>
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {showMoney
            ? tile(`/fleet/${id}?tab=history`, <Stat className={tileClass} label="Repair spend · 90 days" value={f.money(spend?._sum.cost ?? 0)} hint={`${repairs90} completed repair${repairs90 === 1 ? "" : "s"}`} icon={<Wrench />} />)
            : tile(`/fleet/${id}?tab=history`, <Stat className={tileClass} label="Repairs · 90 days" value={repairs90} icon={<Wrench />} />)}
          {tile(`/fleet/${id}?tab=expenses`, <Stat className={tileClass} label={`${f.labels.economy} · 90 days`} value={economy == null ? "—" : f.decimal(economy)}
            hint={economy == null ? "needs fuel fills and two odometer readings" : `${f.vol(fuel90._sum.liters ?? 0)} over ${f.dist(distance)}`} icon={<Droplet />} />)}
          {tile(`/fleet/${id}?tab=expenses`, <Stat className={tileClass} label={`Driven · 90 days`} value={f.dist(distance)}
            hint={distance ? "from odometer readings" : "needs two odometer readings"} tone={distance ? "neutral" : "warn"} icon={<Route />} />)}
          {tile(repair ? `/maintenance/work-orders/${repair.id}` : `/fleet/${id}?tab=maintenance`, <Stat className={tileClass} label="Open repair" value={repair ? roLabel(repair.number) : "None"}
            hint={repair ? (repair.status === "IN_PROGRESS" ? (repair.stage ? REPAIR_STAGE_LABELS[repair.stage] ?? repair.stage : "In the shop") : `Scheduled ${f.day(repair.scheduledAt)}`) : "nothing open"}
            tone={repair?.status === "IN_PROGRESS" ? "warn" : "neutral"} />)}
        </div>

        <Card title="Position & telematics" flush actions={
          <span className="inline-flex items-center gap-2 text-[11px] text-fg-subtle">
            <StatusDot tone={stale ? "neutral" : "accent"} pulse={!stale} />
            {truck.lastPingAt ? `${ago(truck.lastPingAt)} · ${pingSourceLabel(truck.pingSource)}` : "No position yet"}
          </span>
        }>
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
            <Metric icon={<Gauge />} label="Speed" value={truck.speedKmh == null ? "—" : f.number(truck.speedKmh)} unit={truck.speedKmh == null ? undefined : f.labels.speed}
              hint={truck.speedKmh == null ? "no live data" : `${truck.speedKmh > 1 ? "Moving" : "Stopped"}${truck.pingSource === "TRACKPRO" ? " · ≈ from GPS" : ""}`} />
            <Metric icon={<Fuel />} label="Fuel" value={truck.fuelPct == null ? "—" : `${Math.round(truck.fuelPct)}`} unit={truck.fuelPct == null ? undefined : "%"}
              hint={truck.fuelPct == null ? "not recorded" : `≈ ${f.number((truck.fuelPct / 100) * truck.fuelCapacityL)} of ${f.number(truck.fuelCapacityL)} ${f.labels.volume}${eld?.defPct != null ? ` · DEF ${Math.round(eld.defPct)}%` : ""}`}
              bar={truck.fuelPct == null ? undefined : { value: truck.fuelPct / 100, tone: fuelTone(truck.fuelPct) }} />
            <Metric icon={<Power />} label="Engine" value={truck.engineOn == null ? "—" : truck.engineOn ? "On" : "Off"} tone={truck.engineOn ? "ok" : "neutral"}
              hint={eld?.driverName ? `ELD driver ${eld.driverName}` : truck.fuelEconomy ? `${f.economyText(truck.fuelEconomy)} rolling` : undefined} />
            <Metric icon={<MapPin />} label="Location" value={truck.locationName ?? "Unknown"} small hint={hasPosition ? `${truck.lat!.toFixed(4)}, ${truck.lng!.toFixed(4)}` : truck.locationName ? "not on the map" : undefined} />
            <Metric icon={<Compass />} label="Heading" value={compass(truck.heading)} hint={truck.heading != null ? `${Math.round(truck.heading)}°` : undefined} />
            <Metric icon={<Radio />} label="Last update" value={truck.lastPingAt ? ago(truck.lastPingAt).replace(" ago", "") : "—"} small hint={pingSourceLabel(truck.pingSource)} tone={truck.lastPingAt && pingStale(truck.lastPingAt, 24 * 7) ? "warn" : "neutral"} />
          </div>
          {hasPosition ? (
            <div className="p-2">
              <LeafletMap height={240} fitKey={id} layerSwitch trucks={[{
                id: truck.id, unitNumber: truck.unitNumber, lat: truck.lat, lng: truck.lng, heading: truck.heading ?? 0, speedKmh: truck.speedKmh ?? 0,
                status: truck.status, driverName: truck.driver?.name, moving: (truck.speedKmh ?? 0) > 1, stale,
                label: truck.locationName ?? "Last known position",
              }]} />
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-[12px] text-fg-muted">
              {truck.locationName ? `"${truck.locationName}" names no known city, so the truck is not on the map.` : "No position yet."}
              {editable && <> Enter a city in <Link href="#readings" className="font-medium text-fg hover:underline">Update readings</Link> to put it on the map.</>}
            </p>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card id="service" className="scroll-mt-20" title={<span className="flex items-center gap-1.5">Next oil service<InfoTip>Due at the last oil change plus the interval. Completing an oil-change repair order resets it.</InfoTip></span>}
          actions={editable && <LinkButton href={`/maintenance/oil?book=${id}`} variant="secondary" size="sm">Schedule</LinkButton>}>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <p className="eyebrow">{s.state === "overdue" ? "Over by" : s.state === "unknown" ? "Not set up" : `${f.labels.distanceLong[0].toUpperCase()}${f.labels.distanceLong.slice(1)} left`}</p>
              <p className={cn("num mt-1 text-[22px] font-semibold leading-none", svcTone === "danger" ? "text-danger" : svcTone === "warn" ? "text-warn" : "text-fg")}>{big}</p>
              {days != null && <p className="mt-1 text-[12px] text-fg-muted">≈ {f.number(days)} days at recent driving</p>}
            </div>
            <Badge value={s.state} tone={svcTone} label={SERVICE_STATE_LABELS[s.state]} />
          </div>
          {s.pct != null && <Progress value={s.pct} tone={svcTone === "neutral" ? "progress" : svcTone} className="mb-3" />}
          {svc.detail && s.state !== "ok" && s.state !== "due_soon" && s.state !== "due_now" && <p className="mb-3 text-[12px] text-fg-muted">{svc.detail}</p>}
          <DL cols={1} items={[
            ["Interval", (
              <span key="i" className="flex items-center justify-between gap-2">
                <span className="num truncate">{intervalText(s, f)}</span>
                {editable && <Link href={`/fleet/${id}/edit#service`} className="shrink-0 text-[12px] font-medium text-accent-text hover:underline">Change</Link>}
              </span>
            )],
            ["Last oil change", truck.lastPmKm != null ? <span key="l" className="num">{f.dist(truck.lastPmKm)}{truck.lastPmAt ? ` · ${f.date(truck.lastPmAt)}` : ""}</span> : "Not recorded"],
            ["Due at", s.dueAtKm != null ? <span key="d" className="num">{f.dist(s.dueAtKm)}</span> : "—"],
            ["Odometer", (
              <span key="o" className="num">
                {f.dist(truck.odometerKm)}{" "}
                <span className={cn("font-normal", s.stale ? "text-warn" : "text-fg-subtle")}>{truck.odometerAt ? `as of ${f.date(truck.odometerAt)}` : "· not dated"}</span>
                {gps > 0 && (
                  <span className="block text-[11px] font-normal text-fg-subtle" title="Straight-line distance between ELD positions since this reading: a little short of the road. Not used for the oil countdown.">
                    ≈ {f.dist(truck.odometerKm + gps)} now · +{f.dist(gps)} by GPS
                  </span>
                )}
              </span>
            )],
          ]} />
        </Card>

        {editable && (
          <Card id="readings" className="scroll-mt-20" title={
            <span className="flex items-center gap-1.5">Update readings
              <InfoTip>Keeps the oil countdown, the lease cap and the map current while the truck has no tracker. Fill in only what you have; the same odometer again confirms it as of now.</InfoTip>
            </span>
          }>
            <ActionForm action={updateTruckReadings.bind(null, id)} resetOnSuccess className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Odometer (${f.labels.distance})`} hint={`Now ${f.dist(truck.odometerKm)}`}>
                  <Input name="odometerKm" type="number" min={0} step={1} inputMode="numeric" placeholder={String(truck.odometerKm)} className="num" />
                </Field>
                <Field label="Fuel (%)" hint={truck.fuelPct != null ? `Now ${Math.round(truck.fuelPct)}%` : "Not recorded yet"}>
                  <Input name="fuelPct" type="number" min={0} max={100} step={1} inputMode="numeric" placeholder="0–100" className="num" />
                </Field>
              </div>
              <Field label="Location" hint={truck.locationName ? `Now ${truck.locationName}${truck.lastPingAt ? `, ${ago(truck.lastPingAt)}` : ""}` : "A known city puts the truck on the map."}>
                <Input name="locationName" list="reading-cities" placeholder="Joliet, IL" />
                <datalist id="reading-cities">{CITIES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              </Field>
              <span className="flex items-center gap-1.5">
                <Checkbox name="confirm" label={<span className="text-[12px] text-fg-muted">I&apos;ve checked this reading</span>} />
                <InfoTip>Only needed to wind the odometer back (a correction) or to save more than {f.dist(ODOMETER_JUMP_KM)} above the last reading.</InfoTip>
              </span>
              <SubmitButton variant="secondary" className="w-full" pendingText="Saving…">Save readings</SubmitButton>
            </ActionForm>
            <p className={cn("mt-3 text-[11px]", s.stale ? "text-warn" : "text-fg-subtle")}>
              {truck.odometerAt ? `Odometer read ${f.dateTime(truck.odometerAt)}${readingAge != null && readingAge > 0 ? ` · ${readingAge} day${readingAge === 1 ? "" : "s"} ago` : ""}` : "The odometer has no reading date yet"}
            </p>
          </Card>
        )}

        <Card title="Assignment" actions={<Link href={`/fleet/${id}?tab=driver`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Driver history →</Link>}>
          <div className="space-y-4">
            <div>
              <p className="eyebrow mb-1">Driver</p>
              {truck.driver ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/drivers/${truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{truck.driver.name}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                      <span>{DRIVER_TYPE_LABELS[truck.driver.type] ?? truck.driver.type}</span>
                      {truck.driver.dispatcher && <span>· dispatch {truck.driver.dispatcher}</span>}
                      {truck.driver.status !== "ACTIVE" && <Badge value={truck.driver.status} />}
                      {truck.driver.hold && <Chip tone="warn" title={truck.driver.holdReason ?? undefined}>Hold</Chip>}
                    </div>
                  </div>
                  {truck.driver.phone && <a href={`tel:${truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                </div>
              ) : (
                <p className="text-[13px] text-fg-muted">No driver{editable && <> · <Link href={`/fleet/${id}?tab=driver`} className="font-medium text-fg hover:underline">Assign a driver</Link></>}</p>
              )}
            </div>
            <div>
              <p className="eyebrow mb-1">Paired trailers</p>
              {truck.trailers.length === 0 ? (
                <p className="text-[13px] text-fg-muted">None paired{editable && <> · <Link href="/fleet/trailers" className="font-medium text-fg hover:underline">Pair one from its trailer page</Link></>}</p>
              ) : (
                <ul className="space-y-1">
                  {truck.trailers.map((tr) => (
                    <li key={tr.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <Link href={`/fleet/trailers/${tr.id}`} className="num font-medium text-fg hover:underline">{tr.unitNumber}</Link>
                      <span className="flex items-center gap-2 text-[11px] text-fg-subtle">{EQUIPMENT_LABELS[tr.type] ?? tr.type}<Badge value={tr.status} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card title="Identity" actions={<Link href={`/fleet/${id}?tab=specs`} className="text-[11px] font-medium text-fg-muted hover:text-fg">All specs →</Link>}>
          <DL items={[
            ["Plate", <span key="p" className="num">{truck.plate || "—"}</span>],
            ["VIN", <span key="v" className="num">{truck.vin ?? "—"}</span>],
            ["Truck type", truck.truckType?.name ?? "No type"],
            ["In service since", f.date(truck.inServiceAt)],
            ["Home terminal", truck.homeTerminal ?? truck.group ?? "—"],
            ["Ownership", lease ? `${OWNERSHIP_LABELS[truck.ownership]} · ${truck.lessor ?? "lessor not set"}` : OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership],
          ]} />
        </Card>
      </div>
    </div>
  );
}

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
