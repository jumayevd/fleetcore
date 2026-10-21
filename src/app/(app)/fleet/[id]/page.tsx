import Link from "next/link";
import { notFound } from "next/navigation";
import { format, startOfMonth, subMonths } from "date-fns";
import { ChevronRight, Pencil, Wrench, Gauge, Fuel, Power, Compass, Radio, MapPin, Phone, Plus } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CITIES, DRIVER_TYPE_LABELS, EQUIPMENT_LABELS, OWNERSHIP_LABELS, WORK_ORDER_CATEGORIES, WORK_ORDER_CATEGORY_LABELS } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS, DOC_KIND_LABELS } from "@/lib/documents";
import { kmDriven } from "@/lib/mileage";
import { money, money2, number, date, ago, daysUntil, km, toDateInput, daysAgo } from "@/lib/format";
import { saveMaintenance, addFuelLog, addTruckNote, updateTruckReadings } from "@/app/actions/fleet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, Chip, DL, EmptyState, ExpiryBadge, Field, InfoTip, Input, LinkButton, PageHeader, Progress, Select, Stat, StatusDot, Table, Tabs, Textarea, cn, type Tone } from "@/components/ui";
import { Spark } from "@/components/charts-lite";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { TruckStatusMenu } from "./status-menu";
import { WorkOrderActions } from "../work-order-actions";
import {
  compass, daysSince, docExpiryByUnit, EXPIRY_SOON_DAYS, FUEL_TYPE_LABELS, fuelTone, leaseStatus, missingDocs, ODOMETER_JUMP_KM, OWNERSHIP_TONE, paperworkExpiry,
  parseNotes, pingSourceLabel, pingStale, pmStatus, READINGS_STALE_DAYS, TRUCK_STATUS_LABELS,
} from "../lib";

const TABS = ["overview", "maintenance", "specs", "costs", "compliance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", maintenance: "Maintenance", specs: "Specs", costs: "Costs", compliance: "Compliance" };
/** Old links (?tab=financial) still land on the right tab. */
const TAB_ALIASES: Record<string, Tab> = { financial: "costs" };
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
  const tabParam = String(sp.tab);
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : TAB_ALIASES[tabParam] ?? "overview";
  const editable = can(user.role, "fleet.edit");

  const truck = await db.truck.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true, phone: true, hold: true, holdReason: true, status: true, type: true } },
      trailers: { select: { id: true, unitNumber: true, type: true, status: true }, orderBy: { unitNumber: "asc" } },
    },
  });
  if (!truck) notFound();

  const [docRows, openWo, lastReading] = await Promise.all([
    db.document.findMany({ where: { truckId: id, kind: { in: [...REQUIRED_UNIT_DOCS] } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, expiresAt: true } }),
    db.workOrder.count({ where: { truckId: id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    lastOdometerReading(id, truck.createdAt),
  ]);
  const have = new Set(docRows.map((d) => d.kind));
  const missing = missingDocs(have, REQUIRED_UNIT_DOCS);
  // Earlier of the record date and the newest uploaded document's expiry, so a stale record can't hide an expired paper.
  const paper = paperworkExpiry(truck, docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id));
  const fuelLabel = FUEL_TYPE_LABELS[truck.fuelType] ?? truck.fuelType;
  const pm = pmStatus(truck);
  const lease = leaseStatus(truck);
  const stale = pingStale(truck.lastPingAt);
  const readingAge = daysSince(lastReading.at);
  const readingsHref = editable ? `/fleet/${id}#readings` : `/fleet/${id}?tab=maintenance`;

  // Exceptions on this unit — the triage list a fleet specialist reads first.
  const attention: { tone: Tone; text: string; href: string }[] = [];
  if (pm.state === "overdue") attention.push({ tone: "danger", text: `PM overdue by ${number(-(pm.left ?? 0))} km`, href: `/fleet/${id}?tab=maintenance` });
  else if (pm.state === "due") attention.push({ tone: "warn", text: `PM due in ${number(pm.left ?? 0)} km`, href: `/fleet/${id}?tab=maintenance` });
  else if (pm.state === "unknown") attention.push({ tone: "info", text: "No PM schedule: enter the last PM or the next service km", href: editable ? `/fleet/${id}/edit` : `/fleet/${id}?tab=maintenance` });
  if (truck.status === "ACTIVE" && readingAge > READINGS_STALE_DAYS) {
    attention.push({ tone: "warn", text: `Odometer last updated ${readingAge} days ago, so the PM countdown may be behind`, href: readingsHref });
  }
  if (lease?.state === "over") attention.push({ tone: "danger", text: `${number(lease.overKm)} km over the lease cap · ${money(lease.exposure)} exposure`, href: `/fleet/${id}?tab=costs` });
  else if (lease && lease.state !== "ok") attention.push({ tone: "warn", text: `${number(lease.remainingKm)} km left before the lease hard cap`, href: `/fleet/${id}?tab=costs` });
  for (const kind of REQUIRED_UNIT_DOCS) {
    const d = daysUntil(paper[kind]);
    if (d != null && d < 0) attention.push({ tone: "danger", text: `${DOC_KIND_LABELS[kind]} expired ${-d}d ago`, href: `/fleet/${id}?tab=compliance` });
    else if (d != null && d <= EXPIRY_SOON_DAYS) attention.push({ tone: "warn", text: `${DOC_KIND_LABELS[kind]} expires in ${d}d`, href: `/fleet/${id}?tab=compliance` });
  }
  if (missing.length) attention.push({ tone: "warn", text: `Paperwork incomplete: ${missing.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")} not on file`, href: `/fleet/${id}?tab=compliance` });
  // Assigning happens on the edit form; viewers without fleet.edit go to the drivers list instead of a redirect.
  if (truck.status === "ACTIVE" && !truck.driver) attention.push({ tone: "info", text: "No driver assigned", href: editable ? `/fleet/${id}/edit` : "/drivers" });
  if (truck.driver?.hold) attention.push({ tone: "warn", text: `${truck.driver.name} is on hold${truck.driver.holdReason ? `: ${truck.driver.holdReason}` : ""}`, href: `/drivers/${truck.driver.id}` });
  if (truck.status === "MAINTENANCE" && openWo === 0) attention.push({ tone: "info", text: "In shop with no open work order", href: `/fleet/${id}?tab=maintenance` });

  const tabs = TABS.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/fleet/${id}${t === "overview" ? "" : `?tab=${t}`}`,
    count: t === "maintenance" ? openWo || undefined : t === "compliance" ? missing.length || undefined : undefined,
  }));
  const hasPosition = truck.lat != null && truck.lng != null;

  return (
    <>
      <PageHeader
        eyebrow={`${truck.year} ${truck.make} ${truck.model}`}
        title={<span className="num">{truck.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!editable && <Badge value={truck.status} label={TRUCK_STATUS_LABELS[truck.status]} dot />}
            <span>{truck.year} {truck.make} {truck.model}</span>
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

            <Card title="Position & telematics" flush actions={
              <span className="inline-flex items-center gap-2 text-[11px] text-fg-subtle">
                <StatusDot tone={stale ? "neutral" : "accent"} pulse={!stale} />
                {truck.lastPingAt ? `${ago(truck.lastPingAt)} · ${pingSourceLabel(truck.pingSource)}` : "No position yet"}
              </span>
            }>
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
                <Metric icon={<Gauge />} label="Speed" value={truck.speedKmh == null ? "—" : `${Math.round(truck.speedKmh)}`} unit={truck.speedKmh == null ? undefined : "km/h"}
                  hint={truck.speedKmh == null ? "no live data" : truck.speedKmh > 1 ? "Moving" : "Stopped"} />
                <Metric icon={<Fuel />} label="Fuel" value={truck.fuelPct == null ? "—" : `${Math.round(truck.fuelPct)}`} unit={truck.fuelPct == null ? undefined : "%"}
                  hint={truck.fuelPct == null ? "not recorded" : `≈ ${number(Math.round((truck.fuelPct / 100) * truck.fuelCapacityL))} of ${number(truck.fuelCapacityL)} L`}
                  bar={truck.fuelPct == null ? undefined : { value: truck.fuelPct / 100, tone: fuelTone(truck.fuelPct) }} />
                <Metric icon={<Power />} label="Engine" value={truck.engineOn == null ? "—" : truck.engineOn ? "On" : "Off"} tone={truck.engineOn ? "ok" : "neutral"} hint={truck.fuelEconomy ? `${truck.fuelEconomy.toFixed(1)} L/100km rolling` : undefined} />
                <Metric icon={<MapPin />} label="Location" value={truck.locationName ?? "Unknown"} small hint={hasPosition ? `${truck.lat!.toFixed(4)}, ${truck.lng!.toFixed(4)}` : truck.locationName ? "not on the map" : undefined} />
                <Metric icon={<Compass />} label="Heading" value={compass(truck.heading)} hint={truck.heading != null ? `${Math.round(truck.heading)}°` : undefined} />
                <Metric icon={<Radio />} label="Last update" value={truck.lastPingAt ? ago(truck.lastPingAt).replace(" ago", "") : "—"} small hint={pingSourceLabel(truck.pingSource)} tone={truck.lastPingAt && pingStale(truck.lastPingAt, 24 * 7) ? "warn" : "neutral"} />
              </div>
              {hasPosition ? (
                <div className="p-2">
                  <LeafletMap height={240} fitKey={id} trucks={[{
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

            <Card title="Notes" flush>
              {editable && (
                <ActionForm action={addTruckNote.bind(null, id)} resetOnSuccess className="border-b border-line p-3">
                  <div className="flex items-start gap-2">
                    <Textarea name="note" rows={1} required aria-label="New note" placeholder="Add a note: tyre change, damage, tolls tag, anything the next shift should know" className="min-h-8 flex-1 resize-y" />
                    <SubmitButton size="md" variant="secondary" pendingText="Adding…">Add note</SubmitButton>
                  </div>
                </ActionForm>
              )}
              <NotesList notes={truck.notes} editable={editable} />
            </Card>
          </div>

          <div className="space-y-4">
            {editable && (
              <Card id="readings" className="scroll-mt-20" title={
                <span className="flex items-center gap-1.5">Update readings
                  <InfoTip>Keeps the PM countdown, the lease cap and the map current while the truck has no tracker. Fill in only what you have.</InfoTip>
                </span>
              }>
                <ActionForm action={updateTruckReadings.bind(null, id)} resetOnSuccess className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Odometer (km)" hint={`Now ${km(truck.odometerKm)}`}>
                      <Input name="odometerKm" type="number" min={0} step={1} inputMode="numeric" placeholder={String(truck.odometerKm)} className="num" />
                    </Field>
                    <Field label="Fuel (%)" hint={truck.fuelPct != null ? `Now ${Math.round(truck.fuelPct)}%` : "Not recorded yet"}>
                      <Input name="fuelPct" type="number" min={0} max={100} step={1} inputMode="numeric" placeholder="0–100" className="num" />
                    </Field>
                  </div>
                  <Field label="Location" hint={truck.locationName ? `Now ${truck.locationName}${truck.lastPingAt ? `, ${ago(truck.lastPingAt)}` : ""}` : "A known city puts the truck on the map."}>
                    <Input name="locationName" list="reading-cities" placeholder="Samarkand depot" />
                    <datalist id="reading-cities">{CITIES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                  </Field>
                  <span className="flex items-center gap-1.5">
                    <Checkbox name="confirm" label={<span className="text-[12px] text-fg-muted">I&apos;ve checked this reading</span>} />
                    <InfoTip>Only needed to wind the odometer back (a correction) or to save more than {number(ODOMETER_JUMP_KM)} km above the last reading.</InfoTip>
                  </span>
                  <SubmitButton variant="secondary" className="w-full" pendingText="Saving…">Save readings</SubmitButton>
                </ActionForm>
                <p className="mt-3 text-[11px] text-fg-subtle">Last odometer reading {ago(lastReading.at)} · {lastReading.source}</p>
              </Card>
            )}

            <Card title="Assignment">
              <div className="space-y-4">
                <div>
                  <p className="eyebrow mb-1">Driver</p>
                  {truck.driver ? (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/drivers/${truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{truck.driver.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                          <span>{DRIVER_TYPE_LABELS[truck.driver.type] ?? truck.driver.type}</span>
                          {truck.driver.status !== "ACTIVE" && <Badge value={truck.driver.status} />}
                          {truck.driver.hold && <Chip tone="warn" title={truck.driver.holdReason ?? undefined}>Hold</Chip>}
                        </div>
                      </div>
                      {truck.driver.phone && <a href={`tel:${truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                    </div>
                  ) : (
                    <p className="text-[13px] text-fg-muted">No driver{editable && <> · <Link href={`/fleet/${id}/edit`} className="font-medium text-fg hover:underline">Assign a driver</Link></>}</p>
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

            <Card title="Service & paperwork" actions={<Link href={`/fleet/${id}?tab=compliance`} className="text-[11px] font-medium text-fg-muted hover:text-fg">Compliance →</Link>}>
              <DL items={[
                ["Next PM", pm.left == null ? "—" : <Link key="pm" href={`/fleet/${id}?tab=maintenance`} className={cn("num hover:underline", pm.tone === "danger" ? "text-danger" : pm.tone === "warn" ? "text-warn" : "")}>{pm.left < 0 ? `${number(-pm.left)} km overdue` : `in ${number(pm.left)} km`}</Link>],
                ["Odometer", <span key="o" className="num" title={`Last reading ${ago(lastReading.at)} · ${lastReading.source}`}>{km(truck.odometerKm)}</span>],
                ["Documents", <Link key="d" href={`/fleet/${id}?tab=compliance`} className={cn("num hover:underline", missing.length ? "text-warn" : "text-ok")}>{REQUIRED_UNIT_DOCS.length - missing.length}/{REQUIRED_UNIT_DOCS.length} on file</Link>],
                ["Insurance", <ExpiryBadge key="i" days={daysUntil(paper.INSURANCE)} />],
                ["Inspection", <ExpiryBadge key="n" days={daysUntil(paper.INSPECTION)} />],
                ["Registration", <ExpiryBadge key="r" days={daysUntil(paper.REGISTRATION)} />],
                ...(lease ? [["Lease cap", <Link key="l" href={`/fleet/${id}?tab=costs`} className={cn("num hover:underline", lease.tone === "danger" ? "text-danger" : lease.tone === "warn" ? "text-warn" : "")}>{lease.overKm > 0 ? `${number(lease.overKm)} km over` : `${number(lease.remainingKm)} km left`}</Link>] as [string, React.ReactNode]] : []),
              ]} />
            </Card>

            <Card title="Identity">
              <DL items={[
                ["Unit", <span key="u" className="num">{truck.unitNumber}</span>],
                ["Plate", <span key="p" className="num">{truck.plate}</span>],
                ["Vehicle", `${truck.year} ${truck.make} ${truck.model}`],
                ["VIN", <span key="v" className="num">{truck.vin ?? "—"}</span>],
                ["Ownership", lease ? `${OWNERSHIP_LABELS[truck.ownership]} · ${truck.lessor ?? "lessor not set"}` : OWNERSHIP_LABELS[truck.ownership] ?? truck.ownership],
                ["Group", truck.group ?? "—"],
                ["Fuel", `${fuelLabel} · ${number(truck.fuelCapacityL)} L tank`],
                ["Added", date(truck.createdAt)],
              ]} />
            </Card>
          </div>
        </div>
      )}

      {tab === "maintenance" && <MaintenanceTab truck={truck} editable={editable} />}
      {tab === "specs" && (
        <Card title="Specifications" actions={editable && <LinkButton href={`/fleet/${id}/edit`} variant="secondary" size="sm"><Pencil />Edit</LinkButton>}>
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
            ["Position source", pingSourceLabel(truck.pingSource)],
            ["Rolling fuel economy", truck.fuelEconomy ? <span key="fe" className="num">{truck.fuelEconomy.toFixed(1)} L/100km</span> : "—"],
            ["Added", date(truck.createdAt)],
          ]} />
        </Card>
      )}
      {tab === "costs" && <CostsTab truck={truck} editable={editable} />}
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
                    <td>{doc ? <Badge value="ON_FILE" tone="ok" label="On file" /> : <Badge value="MISSING" tone="warn" label="Missing" />}</td>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

/**
 * When the odometer was last read, and how: a saved reading, a fuel fill or a work order that recorded it. Falls back to
 * the day the truck was added. Used to warn when the PM countdown runs on an old number.
 */
async function lastOdometerReading(truckId: string, addedAt: Date): Promise<{ at: Date; source: string }> {
  const [reading, fill, job] = await Promise.all([
    db.auditLog.findFirst({ where: { entity: "truck", entityId: truckId, action: "readings", details: { contains: "odometer" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.fuelLog.findFirst({ where: { truckId, odometerKm: { not: null } }, orderBy: { date: "desc" }, select: { date: true } }),
    db.workOrder.findFirst({ where: { truckId, odometerKm: { not: null }, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
  ]);
  const candidates = [
    reading && { at: reading.createdAt, source: "manual update" },
    fill && { at: fill.date, source: "fuel fill" },
    job?.completedAt && { at: job.completedAt, source: "work order" },
  ].filter((c): c is { at: Date; source: string } => Boolean(c));
  return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? { at: addedAt, source: "when the truck was added" };
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

function NotesList({ notes, editable }: { notes: string | null; editable: boolean }) {
  const items = parseNotes(notes);
  if (items.length === 0) {
    return <p className="px-4 py-5 text-center text-[12px] text-fg-muted">{editable ? "No notes yet. Anything the next shift should know about this truck goes here." : "No notes on this truck yet."}</p>;
  }
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
  const all = `/maintenance/work-orders?unit=${truck.id}&status=all`;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Card title="Work orders" flush actions={
          <span className="text-[11px] text-fg-subtle">
            <span className="num">{open.length}</span> open · <span className="num">{done.length}</span> completed · <Link href={`/fleet/${truck.id}?tab=costs`} className="hover:text-fg hover:underline"><span className="num">{money(spend12)}</span> last 12 months</Link>
            {workOrders.length > 0 && <> · <Link href={all} className="font-medium text-fg-muted hover:text-fg">All in Maintenance →</Link></>}
          </span>
        }>
          {workOrders.length > 0 && (
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
          )}
          {workOrders.length === 0 && (
            <EmptyState icon={<Wrench />} title="No work orders yet"
              description={editable ? "Create the first one on the right: PM services, repairs and inspections all live here." : "PM services, repairs and inspections for this truck will appear here."} />
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={<span className="flex items-center gap-1.5">PM schedule<InfoTip>Completing a PM work order resets the last PM and schedules the next one automatically.</InfoTip></span>}
          actions={editable && <LinkButton href={`/maintenance/work-orders/new?truck=${truck.id}&category=PM`} variant="secondary" size="sm">Book PM</LinkButton>}>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <p className="eyebrow">{pm.state === "overdue" ? "Overdue by" : "Kilometres left"}</p>
              <p className={cn("num mt-1 text-[22px] font-semibold leading-none", pm.tone === "danger" ? "text-danger" : pm.tone === "warn" ? "text-warn" : "text-fg")}>
                {pm.left == null ? "—" : `${number(Math.abs(pm.left))} km`}
              </p>
            </div>
            {pm.state !== "unknown" && <Badge value={pm.state.toUpperCase()} tone={pm.tone} label={pm.state === "overdue" ? "Overdue" : pm.state === "due" ? "Due soon" : "On schedule"} />}
          </div>
          {pm.pct != null && <Progress value={pm.pct} tone={pm.tone} className="mb-3" />}
          {pm.state === "unknown" && (
            <p className="mb-3 text-[12px] text-fg-muted">
              No PM recorded yet.{editable && <> <Link href={`/fleet/${truck.id}/edit`} className="font-medium text-fg hover:underline">Enter the last PM</Link> to start the countdown.</>}
            </p>
          )}
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
            title={<span className="flex items-center gap-1.5">New work order<InfoTip>Starting it now moves the truck to In shop; Done records work that is already completed, dated on the day you pick.</InfoTip></span>}>
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
                <Select name="status" options={[{ value: "OPEN", label: "Open — scheduled" }, { value: "IN_PROGRESS", label: "In progress — truck is in the shop" }, { value: "DONE", label: "Done — already completed" }]} />
              </Field>
              <SubmitButton className="w-full" pendingText="Creating…">Create work order</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-[11px] text-fg-subtle">Need labour and parts, priority or notes? <Link href={`/maintenance/work-orders/new?truck=${truck.id}`} className="font-medium text-fg-muted hover:text-fg hover:underline">Open the full form</Link></p>
          </Card>
        )}
      </div>
    </div>
  );
}

type CostsTruck = {
  id: string; odometerKm: number; ownership: string; lessor: string | null;
  leaseStartKm: number | null; leaseAnnualLimitKm: number | null; leaseBufferPct: number | null; leaseOverageRate: number | null;
};

async function CostsTab({ truck, editable }: { truck: CostsTruck; editable: boolean }) {
  const now = new Date();
  const since = daysAgo(90);
  const monthStarts = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(now, 5 - i)));
  const from = monthStarts[0] < since ? monthStarts[0] : since;
  const ids = [truck.id];
  const [fuel, wos, fuelLogs, km90, monthKm] = await Promise.all([
    db.fuelLog.findMany({ where: { truckId: truck.id, date: { gte: from } }, select: { cost: true, liters: true, date: true } }),
    db.workOrder.findMany({ where: { truckId: truck.id, status: "DONE", completedAt: { gte: from } }, select: { cost: true, completedAt: true } }),
    db.fuelLog.findMany({ where: { truckId: truck.id }, orderBy: { date: "desc" }, take: 12, include: { driver: { select: { name: true } } } }),
    kmDriven(since, now, ids),
    Promise.all(monthStarts.map((m, i) => kmDriven(m, i === monthStarts.length - 1 ? now : monthStarts[i + 1], ids))),
  ]);

  const distance = km90.byTruck.get(truck.id) ?? 0;
  const f90 = fuel.filter((f) => f.date >= since);
  const w90 = wos.filter((w) => w.completedAt && w.completedAt >= since);
  const fuelCost = f90.reduce((a, f) => a + f.cost, 0);
  const liters = f90.reduce((a, f) => a + f.liters, 0);
  const woCost = w90.reduce((a, w) => a + w.cost, 0);
  const costPerKm = distance ? (fuelCost + woCost) / distance : null;
  const l100 = distance && liters ? (liters / distance) * 100 : null;

  const rows = monthStarts.map((m, i) => ({ key: format(m, "yyyy-MM"), month: format(m, "MMM yy"), km: monthKm[i].byTruck.get(truck.id) ?? 0, liters: 0, fuel: 0, wo: 0 }));
  const at = (d: Date | null) => (d ? rows.find((r) => r.key === format(d, "yyyy-MM")) : undefined);
  for (const f of fuel) { const r = at(f.date); if (r) { r.fuel += f.cost; r.liters += f.liters; } }
  for (const w of wos) { const r = at(w.completedAt); if (r) r.wo += w.cost; }
  const totals = rows.reduce((a, r) => ({ km: a.km + r.km, liters: a.liters + r.liters, fuel: a.fuel + r.fuel, wo: a.wo + r.wo }), { km: 0, liters: 0, fuel: 0, wo: 0 });
  const lease = leaseStatus(truck);
  const perKm = (cost: number, kmDone: number) => (kmDone ? money2(cost / kmDone) : "—");
  const per100 = (l: number, kmDone: number) => (kmDone && l ? `${((l / kmDone) * 100).toFixed(1)}` : "—");
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";
  const noDistance = distance === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Distance (90d)" value={km(distance)} hint={noDistance ? "needs two odometer readings" : "from odometer readings"} tone={noDistance ? "warn" : "neutral"} spark={<Spark data={rows.map((r) => r.km)} tone="info" />} />
        {tile("#fuel-log", <Stat className={tileClass} label="Fuel (90d)" value={money(fuelCost)} hint={`${number(Math.round(liters))} L in ${f90.length} fills`} />)}
        {tile(`/maintenance/work-orders?unit=${truck.id}&status=DONE`, <Stat className={tileClass} label="Work orders (90d)" value={money(woCost)} hint={`${w90.length} completed`} />)}
        <Stat label="Cost per km (90d)" value={costPerKm == null ? "—" : money2(costPerKm)} hint="fuel + work orders ÷ km driven" spark={<Spark data={rows.map((r) => (r.km ? (r.fuel + r.wo) / r.km : 0))} tone="warn" />} />
        <Stat label="Fuel economy (90d)" value={l100 == null ? "—" : `${l100.toFixed(1)} L/100km`} hint="litres filled ÷ km driven" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={<span className="flex items-center gap-1.5">Last 6 months<InfoTip>Distance comes from odometer readings: fuel fills, work orders, saved readings and the current odometer. Fuel by fill date, work orders by completion date.</InfoTip></span>} flush>
            <Table dense stickyHead={false} head={["Month", "Distance", "Fuel", "Fuel cost", "Work orders", "Total cost", "Cost/km", "L/100km"]}>
              {rows.map((r) => (
                <tr key={r.key} className={!r.km && !r.fuel && !r.wo ? "text-fg-subtle" : undefined}>
                  <td className="font-medium text-fg">{r.month}</td>
                  <td className="num">{km(Math.round(r.km))}</td>
                  <td className="num text-fg-muted">{number(Math.round(r.liters))} L</td>
                  <td className="num text-fg-muted">{money(r.fuel)}</td>
                  <td className="num text-fg-muted">{money(r.wo)}</td>
                  <td className="num">{money(r.fuel + r.wo)}</td>
                  <td className="num">{perKm(r.fuel + r.wo, r.km)}</td>
                  <td className="num text-fg-muted">{per100(r.liters, r.km)}</td>
                </tr>
              ))}
              <tr className="bg-sunken/60 font-medium">
                <td>Total</td>
                <td className="num">{km(Math.round(totals.km))}</td>
                <td className="num">{number(Math.round(totals.liters))} L</td>
                <td className="num">{money(totals.fuel)}</td>
                <td className="num">{money(totals.wo)}</td>
                <td className="num">{money(totals.fuel + totals.wo)}</td>
                <td className="num">{perKm(totals.fuel + totals.wo, totals.km)}</td>
                <td className="num">{per100(totals.liters, totals.km)}</td>
              </tr>
            </Table>
            {noDistance && (
              <p className="border-t border-line px-4 py-2 text-[12px] text-fg-muted">
                Distance needs at least two odometer readings.{editable && <> Log fuel with the odometer, or <Link href={`/fleet/${truck.id}#readings`} className="font-medium text-fg hover:underline">update the reading</Link> regularly.</>}
              </p>
            )}
          </Card>

          <Card id="fuel-log" className="scroll-mt-20" title="Fuel log" flush actions={fuelLogs.length > 0 && <span className="text-[11px] text-fg-subtle">Last {fuelLogs.length} fills</span>}>
            {fuelLogs.length > 0 && (
              <Table dense stickyHead={false} head={["Date", "Station", "Litres", "Cost", "Per litre", "Odometer", "Driver"]}>
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
            )}
            {fuelLogs.length === 0 && (
              <EmptyState icon={<Fuel />} title="No fuel logged yet"
                description={editable ? "Log fills on the right. With the odometer on each fill you get distance, cost per km and fuel economy." : "Fuel fills appear here once someone logs them."} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {editable && (
            <Card title={<span className="flex items-center gap-1.5">Log fuel<InfoTip>An odometer reading higher than the truck&apos;s moves the truck&apos;s odometer forward.</InfoTip></span>}>
              <ActionForm action={addFuelLog.bind(null, truck.id)} resetOnSuccess className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Litres" required><Input name="liters" type="number" step="0.1" min={0} required className="num" /></Field>
                  <Field label="Cost (USD)" required><Input name="cost" type="number" step="0.01" min={0} required className="num" /></Field>
                  <Field label="Odometer (km)"><Input name="odometerKm" type="number" min={0} placeholder={String(truck.odometerKm)} className="num" /></Field>
                  <Field label="Date"><Input name="date" type="date" defaultValue={toDateInput(now)} /></Field>
                </div>
                <Field label="Station"><Input name="station" placeholder="UNG Tashkent ring road" /></Field>
                <SubmitButton variant="secondary" className="w-full" pendingText="Logging…"><Plus />Log fuel</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {lease && (
            <Card title="Lease mileage" actions={<Badge value={lease.state.toUpperCase()} tone={lease.tone} label={lease.state === "over" ? "Over cap" : lease.state === "buffer" ? "In buffer" : lease.state === "near" ? "Near cap" : "Within limit"} />}>
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
        </div>
      </div>
    </div>
  );
}
