import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Activity, Archive, Ban, Container, Plus, TriangleAlert, Truck as TruckIcon, Wrench, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { OWNERSHIP, OWNERSHIP_LABELS, REPAIR_STAGE_LABELS, TRUCK_STATUSES } from "@/lib/constants";
import { DOC_KIND_LABELS, REQUIRED_UNIT_DOCS, UNIT_DOC_SLOTS } from "@/lib/documents";
import { ago, daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { daysToCover, distancePerDay } from "@/lib/mileage";
import { OIL_DUE_SOON, roLabel, serviceStatus, type ServiceState } from "@/lib/service";
import { Badge, Card, Cell, Chip, EmptyState, ExpiryBadge, InfoTip, LinkButton, PageHeader, Progress, Segmented, Stat, Table, cn, type Tone } from "@/components/ui";
import { ListFilters } from "./filters";
import { LinkRow } from "./link-row";
import { ColumnChooser, type ColumnDef } from "./column-chooser";
import { openDefects, openRepairs, truckTypeOptions, unitDocRows } from "./data";
import {
  docExpiryByUnit, docsByUnit, earliest, EXPIRY_SOON_DAYS, fuelTone, LIST_LIMIT, missingDocs, OWNERSHIP_SHORT, OWNERSHIP_TONE, pingStale,
  serviceSummary, sinceShort, TRUCK_STATUS_LABELS, TRUCK_VIEW_LABELS, TRUCK_VIEW_STATUSES, TRUCK_VIEWS, type TruckView,
} from "./lib";

export const metadata = { title: "Trucks" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneOf = <T extends string>(list: readonly T[], v: string | undefined) => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);

const DRIVER_FILTERS = { none: "No driver", assigned: "Has a driver" } as const;
const SERVICE_FILTERS = ["overdue", "due", "no_reading", "unknown"] as const;
const DOCS_FILTERS = ["expired", "incomplete"] as const;
const SERVICE_MATCH: Record<(typeof SERVICE_FILTERS)[number], ServiceState[]> = {
  overdue: ["overdue"], due: ["due_now", "due_soon"], no_reading: ["no_reading"], unknown: ["unknown"],
};

/** Columns people can show or hide (Unit always shows). Order = table order. */
const COLUMNS: ColumnDef[] = [
  { key: "vehicle", label: "Vehicle" },
  { key: "type", label: "Truck type", hidden: true },
  { key: "status", label: "Status" },
  { key: "driver", label: "Driver" },
  { key: "location", label: "Location" },
  { key: "odometer", label: "Odometer" },
  { key: "service", label: "Next service" },
  { key: "repair", label: "Repair" },
  { key: "defects", label: "Defects" },
  { key: "papers", label: "Paperwork" },
  { key: "insurance", label: "Insurance", hidden: true },
  { key: "inspection", label: "Annual inspection", hidden: true },
  { key: "registration", label: "Registration", hidden: true },
  { key: "ownership", label: "Ownership", hidden: true },
  { key: "plate", label: "Plate", hidden: true },
  { key: "vin", label: "VIN", hidden: true },
  { key: "terminal", label: "Home terminal", hidden: true },
  { key: "fuel", label: "Fuel level", hidden: true },
];
const TABLE_ID = "truck-table";

/** A dated slot document counts as expired when the newest file of that kind is past its expiry. */
const DATED_SLOTS = UNIT_DOC_SLOTS.truck;

export default async function FleetPage({ searchParams }: PageProps<"/fleet">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;

  const status = oneOf(TRUCK_STATUSES, str(sp.status));
  const view: TruckView = status === "INACTIVE" ? "archived" : oneOf(TRUCK_VIEWS, str(sp.view)) ?? "fleet";
  const attention = str(sp.attention) === "1" ? "1" : undefined;
  const legacyPm = str(sp.pm) === "overdue" ? "overdue" : str(sp.pm) === "due" ? "due" : undefined; // links made before ?service=
  const service = oneOf(SERVICE_FILTERS, str(sp.service)) ?? legacyPm;
  const docsFilter = oneOf(DOCS_FILTERS, str(sp.docs));
  const ownership = oneOf(OWNERSHIP, str(sp.ownership));
  const driver = oneOf(["none", "assigned"] as const, str(sp.driver));
  const group = str(sp.group);
  const type = str(sp.type);
  const q = str(sp.q);
  const params = { view: view === "fleet" ? undefined : view, status, attention, service, docs: docsFilter, ownership, driver, group, type, q };

  const [all, docRows, defects, trailerCount, types] = await Promise.all([
    db.truck.findMany({
      select: {
        id: true, status: true, group: true, homeTerminal: true, driverId: true, ownership: true, truckTypeId: true,
        odometerKm: true, odometerAt: true, pmIntervalKm: true, lastPmKm: true, lastPmAt: true, nextServiceKm: true,
        insuranceExpiry: true, inspectionExpiry: true, registrationExpiry: true,
        truckType: { select: { name: true, oilIntervalKm: true } },
      },
    }),
    unitDocRows("truck"),
    openDefects("truck"),
    db.trailer.count(),
    truckTypeOptions(),
  ]);

  if (all.length === 0) {
    return (
      <>
        <PageHeader title="Trucks" actions={<FleetSwitch trucks={0} trailers={trailerCount} />} />
        <Card>
          <EmptyState icon={<TruckIcon />} title={editable ? "Add your first truck" : "No trucks yet"}
            description={editable
              ? `Each truck gets its oil-change countdown, paperwork slots, repairs, fuel and cost per ${f.labels.distance}. Start with the unit number, plate and odometer.`
              : "Trucks appear here once someone with edit access adds them."}
            action={editable && <LinkButton href="/fleet/new"><Plus />Add truck</LinkButton>} />
        </Card>
      </>
    );
  }

  const now = new Date();
  const have = docsByUnit(docRows.map((d) => ({ id: d.truckId, kind: d.kind })));
  const docExpiry = docExpiryByUnit(docRows.map((d) => ({ id: d.truckId, kind: d.kind, expiresAt: d.expiresAt })));
  const RECORD: Record<string, "registrationExpiry" | "insuranceExpiry" | "inspectionExpiry"> = { REGISTRATION: "registrationExpiry", INSURANCE: "insuranceExpiry", INSPECTION: "inspectionExpiry" };

  /** Per truck: oil service, paperwork expiry per kind, what is missing, what is expired, why it needs a look. */
  const facts = new Map(all.map((t) => {
    const s = serviceStatus(t, now);
    const files = docExpiry.get(t.id);
    const expiry: Record<string, Date | null> = {};
    for (const k of DATED_SLOTS) expiry[k] = earliest(files?.get(k), RECORD[k] ? t[RECORD[k]] : null);
    const expired = Object.entries(expiry).filter(([, d]) => d && d < now).map(([k]) => k);
    const missing = missingDocs(have.get(t.id), REQUIRED_UNIT_DOCS);
    const urgent = defects.get(t.id)?.urgent ?? 0;
    const reasons = [
      urgent ? `${urgent} defect${urgent > 1 ? "s" : ""} to fix now` : null,
      s.state === "overdue" ? "oil service overdue" : null,
      expired.length ? `${expired.map((k) => DOC_KIND_LABELS[k].toLowerCase()).join(", ")} expired` : null,
    ].filter((r): r is string => Boolean(r));
    return [t.id, { s, expiry, expired, missing, reasons }];
  }));
  const fact = (id: string) => facts.get(id)!;

  // Fleet-wide counters (independent of the filters below).
  const count = (s: string) => all.filter((t) => t.status === s).length;
  const working = all.filter((t) => t.status !== "INACTIVE");
  const attentionCount = working.filter((t) => fact(t.id).reasons.length > 0).length;
  const viewCount = (v: TruckView) => all.filter((t) => TRUCK_VIEW_STATUSES[v].includes(t.status)).length;
  const groups = [...new Set(all.flatMap((t) => [t.group, t.homeTerminal]).filter((g): g is string => Boolean(g)))].sort();

  // Computed filters resolve to ids first, so the capped table below stays exact.
  const computed = attention || service || docsFilter
    ? all.filter((t) => {
      const x = fact(t.id);
      if (attention && !x.reasons.length) return false;
      if (service && !SERVICE_MATCH[service].includes(x.s.state)) return false;
      if (docsFilter === "expired" && !x.expired.length) return false;
      if (docsFilter === "incomplete" && !x.missing.length) return false;
      return true;
    }).map((t) => t.id)
    : null;
  const like = { contains: q ?? "", mode: "insensitive" as const };
  const where: Prisma.TruckWhereInput = {
    AND: [
      { status: { in: status ? [status] : [...TRUCK_VIEW_STATUSES[view]] } },
      ownership ? { ownership } : {},
      group ? { OR: [{ group }, { homeTerminal: group }] } : {},
      type ? (type === "none" ? { truckTypeId: null } : { truckTypeId: type }) : {},
      driver === "none" ? { driverId: null } : driver === "assigned" ? { driverId: { not: null } } : {},
      q ? {
        OR: [
          { unitNumber: like }, { plate: like }, { vin: like }, { make: like }, { model: like }, { locationName: like }, { homeTerminal: like },
          { group: like }, { driver: { is: { name: like } } },
        ],
      } : {},
      computed ? { id: { in: computed } } : {},
    ],
  };
  const rows = await db.truck.findMany({
    where, orderBy: { unitNumber: "asc" }, take: LIST_LIMIT + 1,
    include: { driver: { select: { id: true, name: true, hold: true, dispatcher: true } }, truckType: { select: { name: true } } },
  });
  const capped = rows.length > LIST_LIMIT;
  const trucks = capped ? rows.slice(0, LIST_LIMIT) : rows;
  const ids = trucks.map((t) => t.id);
  const [matching, perDay, repairs] = await Promise.all([
    capped ? db.truck.count({ where }) : Promise.resolve(trucks.length),
    distancePerDay(ids),
    openRepairs("truck", ids),
  ]);

  const qs = (patch: Partial<typeof params>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/fleet${s ? `?${s}` : ""}`;
  };
  const filtered = Object.entries(params).some(([k, v]) => k !== "view" && v);
  // A counter filters the list to what it counts; a second click clears it.
  const counter = (on: boolean, href: string, node: React.ReactNode) => (
    <Link href={on ? qs({ status: undefined, attention: undefined, view: undefined }) : href} aria-current={on || undefined}
      className={cn("group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", on && "ring-2 ring-accent/40")}>
      {node}
    </Link>
  );
  const tileClass = "h-full transition-[border-color,box-shadow] group-hover:border-line-strong group-hover:shadow-lift";
  const only = (patch: Partial<typeof params>) => qs({ status: undefined, attention: undefined, view: undefined, ...patch });
  const chipClass = "inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[12px] font-medium text-accent-text hover:opacity-80";
  const col = (key: string, label: React.ReactNode) => <span key={key} data-col={key} className="inline-flex items-center gap-1">{label}</span>;
  const typeOptions = [{ value: "none", label: "No type" }, ...types.map((t) => ({ value: t.id, label: `${t.name} · ${f.dist(t.oilIntervalKm)}` }))];

  return (
    <>
      <PageHeader
        title="Trucks"
        actions={
          <>
            <FleetSwitch trucks={all.length} trailers={trailerCount} />
            {editable && <LinkButton href="/fleet/new"><Plus />Add truck</LinkButton>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {counter(status === "ACTIVE", only({ status: "ACTIVE" }),
          <Stat className={tileClass} label="Available" value={count("ACTIVE")} icon={<Activity />} tone="ok"
            hint={`${all.filter((t) => t.status === "ACTIVE" && !t.driverId).length} without a driver`} />)}
        {counter(status === "MAINTENANCE", only({ status: "MAINTENANCE" }),
          <Stat className={tileClass} label="In shop" value={count("MAINTENANCE")} icon={<Wrench />} tone={count("MAINTENANCE") ? "warn" : "neutral"}
            hint={count("MAINTENANCE") ? "open the repair from the Repair column" : "nothing in the shop"} />)}
        {counter(status === "OUT_OF_SERVICE", only({ status: "OUT_OF_SERVICE" }),
          <Stat className={tileClass} label="Out of service" value={count("OUT_OF_SERVICE")} icon={<Ban />} tone={count("OUT_OF_SERVICE") ? "danger" : "neutral"}
            hint={count("OUT_OF_SERVICE") ? "held until a repair is verified or paperwork is fixed" : "every truck can run"} />)}
        {counter(view === "archived", only({ view: "archived" }),
          <Stat className={tileClass} label="Inactive" value={count("INACTIVE")} icon={<Archive />} hint="sold, retired or parked for good" />)}
        {counter(Boolean(attention), only({ attention: "1" }),
          <Stat className={tileClass} label="Needs attention" value={attentionCount} icon={<TriangleAlert />} tone={attentionCount ? "danger" : "ok"}
            hint={attentionCount ? "defects to fix now, oil overdue or papers expired" : "no urgent defects, overdue oil or expired papers"} />)}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented active={status && status !== "INACTIVE" ? "" : view} items={TRUCK_VIEWS.map((v) => ({
            key: v, label: TRUCK_VIEW_LABELS[v], count: viewCount(v), href: qs({ view: v === "fleet" ? undefined : v, status: undefined }),
          }))} />
          {status && status !== "INACTIVE" && <Link href={qs({ status: undefined })} className={chipClass}>{TRUCK_STATUS_LABELS[status]}<X className="h-3 w-3" /></Link>}
          {attention && <Link href={qs({ attention: undefined })} className={chipClass}>Needs attention<X className="h-3 w-3" /></Link>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListFilters basePath="/fleet" params={params} placeholder="Unit, VIN, plate, driver, location…" selects={[
            {
              name: "service", label: "Oil service", placeholder: "Any service state", options: [
                { value: "overdue", label: "Overdue" }, { value: "due", label: `Due within ${f.dist(OIL_DUE_SOON)}` },
                { value: "no_reading", label: "No recent reading" }, { value: "unknown", label: "No oil change recorded" },
              ],
            },
            { name: "docs", label: "Paperwork", placeholder: "Any paperwork", options: [{ value: "expired", label: "Something expired" }, { value: "incomplete", label: "Required papers missing" }] },
            { name: "driver", label: "Driver", placeholder: "Any driver", options: Object.entries(DRIVER_FILTERS).map(([value, label]) => ({ value, label })) },
            ...(types.length ? [{ name: "type", label: "Truck type", placeholder: "All types", options: typeOptions }] : []),
            { name: "ownership", label: "Ownership", placeholder: "All ownership", options: OWNERSHIP.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] })) },
            ...(groups.length ? [{ name: "group", label: "Terminal or group", placeholder: "All terminals", options: groups.map((g) => ({ value: g, label: g })) }] : []),
          ]} />
          <ColumnChooser tableId={TABLE_ID} storageKey="trucks.columns" columns={COLUMNS} />
        </div>
      </div>

      <Card flush>
        <div id={TABLE_ID}>
          {capped && (
            <p className="border-b border-line bg-info-soft px-4 py-2 text-[12px] text-info">
              Showing the first <span className="num">{trucks.length}</span> of <span className="num">{matching}</span> matching trucks. Narrow the search or filters to see the rest.
            </p>
          )}
          <Table head={[
            "Unit",
            col("vehicle", "Vehicle"),
            col("type", "Truck type"),
            col("status", "Status"),
            col("driver", "Driver"),
            col("location", "Location"),
            col("odometer", <>Odometer<InfoTip>The last reading and how old it is. Older than two weeks, the service countdown is a lower bound.</InfoTip></>),
            col("service", <>Next service<InfoTip>Distance to the next oil change, and roughly how many days that is at this truck&apos;s recent driving. No estimate without two dated readings.</InfoTip></>),
            col("repair", "Repair"),
            col("defects", "Defects"),
            col("papers", <>Paperwork<InfoTip>Registration, insurance and annual inspection on file and in date. Expiry is the earlier of the record and the newest file.</InfoTip></>),
            col("insurance", "Insurance"),
            col("inspection", "Annual inspection"),
            col("registration", "Registration"),
            col("ownership", "Ownership"),
            col("plate", "Plate"),
            col("vin", "VIN"),
            col("terminal", "Home terminal"),
            col("fuel", "Fuel"),
          ]}>
            {trucks.map((t) => {
              const x = fact(t.id);
              const days = daysToCover(x.s.left, perDay.get(t.id));
              const svc = serviceSummary(x.s, f, days);
              const r = repairs.get(t.id);
              const d = defects.get(t.id);
              const stale = x.s.stale;
              return (
                <LinkRow key={t.id} href={`/fleet/${t.id}`} className={t.status === "INACTIVE" ? "opacity-70" : undefined}>
                  <td>
                    <Cell mono primary={<Link href={`/fleet/${t.id}`} className="font-semibold hover:underline">{t.unitNumber}</Link>}
                      secondary={x.reasons.length ? <span className="text-danger" title={x.reasons.join(" · ")}>{x.reasons[0]}</span> : undefined} />
                  </td>
                  <td data-col="vehicle" className="whitespace-nowrap">
                    <Cell primary={`${t.make} ${t.model}`} secondary={String(t.year)} />
                  </td>
                  <td data-col="type" className="whitespace-nowrap text-fg-muted">{t.truckType?.name ?? <span className="text-fg-faint">No type</span>}</td>
                  <td data-col="status"><Badge value={t.status} label={TRUCK_STATUS_LABELS[t.status]} dot /></td>
                  <td data-col="driver">
                    {t.driver ? (
                      <Cell primary={<span className="inline-flex items-center gap-1.5"><Link href={`/drivers/${t.driver.id}`} className="hover:underline">{t.driver.name}</Link>{t.driver.hold && <Chip tone="warn">Hold</Chip>}</span>}
                        secondary={t.driver.dispatcher ? `Dispatch: ${t.driver.dispatcher}` : undefined} />
                    ) : editable && t.status !== "INACTIVE"
                      ? <Link href={`/fleet/${t.id}/edit#driver`} className="text-[12px] text-fg-subtle hover:text-fg hover:underline">Assign driver</Link>
                      : <span className="text-fg-faint">No driver</span>}
                  </td>
                  <td data-col="location" title={t.lastPingAt ? `Position updated ${ago(t.lastPingAt)}` : "No position yet"}>
                    <Cell primary={t.locationName ?? <span className="text-fg-faint">Unknown</span>}
                      secondary={t.lastPingAt && pingStale(t.lastPingAt, 24) ? ago(t.lastPingAt) : undefined} />
                  </td>
                  <td data-col="odometer" className="whitespace-nowrap">
                    <Cell mono primary={f.dist(t.odometerKm)}
                      secondary={<span className={cn(stale && "text-warn")}>{t.odometerAt ? `read ${sinceShort(t.odometerAt)} ago` : "reading not dated"}</span>} />
                  </td>
                  <td data-col="service" className="whitespace-nowrap">
                    <Link href={`/fleet/${t.id}#service`} className="hover:opacity-80" title={svc.detail ?? undefined}>
                      <ServiceCell tone={svc.tone} text={svc.text} state={x.s.state} pct={x.s.pct} />
                    </Link>
                  </td>
                  <td data-col="repair" className="whitespace-nowrap">
                    {r ? (
                      <Link href={`/maintenance/work-orders/${r.id}`} className="group/ro block" title={r.title}>
                        <Cell mono primary={<span className="font-medium group-hover/ro:underline">{roLabel(r.number)}{r.count > 1 && <span className="ml-1 text-[11px] font-normal text-fg-subtle">+{r.count - 1}</span>}</span>}
                          secondary={r.status === "IN_PROGRESS"
                            ? <span className="text-warn">{r.stage ? REPAIR_STAGE_LABELS[r.stage] ?? r.stage : "In the shop"}{r.stageAt || r.inAt ? ` · ${sinceShort(r.stageAt ?? r.inAt)}` : ""}</span>
                            : `Scheduled ${f.day(r.scheduledAt)}`} />
                      </Link>
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td data-col="defects" className="whitespace-nowrap">
                    {d ? (
                      <Link href={`/fleet/${t.id}?tab=maintenance`} className="hover:opacity-80">
                        {d.urgent ? <Badge value="DEFECT" tone="danger" label={`${d.urgent} to fix now`} /> : <Chip tone="warn">{d.open} open</Chip>}
                      </Link>
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td data-col="papers" className="whitespace-nowrap"><PapersCell id={t.id} expired={x.expired} missing={x.missing} expiry={x.expiry} /></td>
                  <td data-col="insurance"><ExpiryBadge days={daysUntil(x.expiry.INSURANCE)} /></td>
                  <td data-col="inspection"><ExpiryBadge days={daysUntil(x.expiry.INSPECTION)} /></td>
                  <td data-col="registration"><ExpiryBadge days={daysUntil(x.expiry.REGISTRATION)} /></td>
                  <td data-col="ownership"><Chip tone={OWNERSHIP_TONE[t.ownership]} className="normal-case tracking-normal">{OWNERSHIP_SHORT[t.ownership] ?? t.ownership}</Chip></td>
                  <td data-col="plate" className="num whitespace-nowrap">{t.plate || <span className="text-fg-faint">—</span>}</td>
                  <td data-col="vin" className="num whitespace-nowrap text-fg-muted">{t.vin ?? <span className="text-fg-faint">—</span>}</td>
                  <td data-col="terminal" className="whitespace-nowrap text-fg-muted">{t.homeTerminal ?? t.group ?? <span className="text-fg-faint">—</span>}</td>
                  <td data-col="fuel">
                    {t.fuelPct == null ? <span className="text-fg-faint">—</span> : (
                      <span className="inline-flex items-center gap-2">
                        <Progress value={t.fuelPct / 100} tone={fuelTone(t.fuelPct)} className="w-12" />
                        <span className={cn("num text-[12px]", t.fuelPct < 15 ? "text-danger" : "text-fg-muted")}>{Math.round(t.fuelPct)}%</span>
                      </span>
                    )}
                  </td>
                </LinkRow>
              );
            })}
          </Table>
          {trucks.length === 0 && (
            <EmptyState
              title={view === "archived" && !filtered ? "No inactive trucks" : view === "off" && !filtered ? "Every truck is on the road" : "No trucks match"}
              description={view === "archived" && !filtered
                ? "Trucks you set to Inactive (sold, retired) move here and stop counting in the fleet."
                : view === "off" && !filtered ? "Trucks in the shop or out of service show here." : "Try another view or filter, or clear the search."}
              action={filtered && <LinkButton href={qs({ status: undefined, attention: undefined, service: undefined, docs: undefined, ownership: undefined, driver: undefined, group: undefined, type: undefined, q: undefined })} variant="secondary">Clear filters</LinkButton>} />
          )}
        </div>
      </Card>
    </>
  );
}

function ServiceCell({ tone, text, state, pct }: { tone: Tone; text: string; state: ServiceState; pct: number | null }) {
  if (state === "overdue" || state === "due_now" || state === "due_soon") return <Badge value={state} tone={tone} label={text} className="num" />;
  if (state === "ok") {
    return (
      <span className="inline-flex items-center gap-2">
        {pct != null && <Progress value={pct} tone="ok" className="w-10" />}
        <span className="num text-fg-muted">{text}</span>
      </span>
    );
  }
  return <span className="text-[12px] text-fg-subtle">{text}</span>;
}

function PapersCell({ id, expired, missing, expiry }: { id: string; expired: string[]; missing: string[]; expiry: Record<string, Date | null> }) {
  const href = `/fleet/${id}?tab=documents`;
  const name = (k: string) => DOC_KIND_LABELS[k]?.toLowerCase() ?? k.toLowerCase();
  if (expired.length) {
    return <Link href={href} className="hover:opacity-80" title={`Expired: ${expired.map(name).join(", ")}`}><Badge value="EXPIRED" tone="danger" label={expired.length > 1 ? `${expired.length} expired` : `${DOC_KIND_LABELS[expired[0]]} expired`} /></Link>;
  }
  const soon = Object.entries(expiry).map(([k, d]) => ({ k, days: daysUntil(d) })).filter((e) => e.days != null && e.days <= EXPIRY_SOON_DAYS).sort((a, b) => a.days! - b.days!);
  if (missing.length) {
    return <Link href={href} className="hover:opacity-80" title={`Missing: ${missing.map(name).join(", ")}`}><Chip tone="warn">{missing.length} missing</Chip></Link>;
  }
  if (soon.length) {
    return <Link href={href} className="hover:opacity-80"><Badge value="SOON" tone="warn" label={`${DOC_KIND_LABELS[soon[0].k]} in ${soon[0].days}d`} /></Link>;
  }
  return <Link href={href} className="text-[12px] text-fg-subtle hover:text-fg hover:underline">In date</Link>;
}

function FleetSwitch({ trucks, trailers }: { trucks: number; trailers: number }) {
  return (
    <Segmented active="trucks" items={[
      { key: "trucks", label: <span className="inline-flex items-center gap-1"><TruckIcon className="h-3.5 w-3.5" />Trucks</span>, href: "/fleet", count: trucks },
      { key: "trailers", label: <span className="inline-flex items-center gap-1"><Container className="h-3.5 w-3.5" />Trailers</span>, href: "/fleet/trailers", count: trailers },
    ]} />
  );
}
