import { redirect } from "next/navigation";
import { AlertTriangle, Check, Clock, Fuel, MessageSquare, Navigation, Package, Phone, Send, Thermometer, Truck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BOARD_STATUS_LABELS, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, TIMEZONE, type BoardStatus, type LoadStatus } from "@/lib/constants";
import { ago, date, dateTime, kg, km, money, number } from "@/lib/format";
import { estimatedArrival, loadProgress, loadRoute, syncSimulatedPositions } from "@/lib/telemetry";
import { driverUpdateLoad } from "@/app/actions/driver";
import { addLoadEvent } from "@/app/actions/loads";
import { addFuelLog } from "@/app/actions/fleet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Chip, EmptyState, Field, InfoTip, Input, LinkButton, Progress, Stat, buttonClass, cn } from "@/components/ui";
import { LeafletMap, type MapPoint, type MapTruck } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { AnnouncementBanner } from "./announcement-banner";
import { GeoFields } from "./geo-fields";
import { GpsShare } from "./gps-share";
import { StatusToggle } from "./status-toggle";
import { StopActions } from "./stop-actions";
import {
  EVENT_LABEL, EVENT_TONE, STOP_TONE, STOP_TYPE_LABEL, STOP_TYPE_TONE, UPDATE_TYPES,
  chatRoomHref, fmtDuration, greetingFor, isDispatchHeld, navigateUrl, sinceLabel, startOfMonth, startOfWeek, windowLabel,
} from "./shared";

export const metadata = { title: "My trips" };

const DONE_STATUSES = ["DELIVERED", "INVOICED"];
const STALE_PING_MS = 15 * 60_000;

const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TIMEZONE }).format(d));

export default async function DriverPortal() {
  const user = await requireUser("driver.portal");
  if (!user.driver) redirect("/account");
  await syncSimulatedPositions();

  const driverId = user.driver.id;
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const driver = await db.driver.findUniqueOrThrow({ where: { id: driverId }, include: { truck: true, team: { select: { name: true } } } });

  const [active, upcoming, recent, week, month, announcement, lastFuel] = await Promise.all([
    db.load.findFirst({
      where: { driverId, status: { in: ["IN_TRANSIT", "ASSIGNED"] } },
      orderBy: [{ status: "desc" }, { pickupAt: "asc" }], // IN_TRANSIT sorts before ASSIGNED
      include: {
        customer: { select: { name: true } },
        trailer: { select: { unitNumber: true, type: true } },
        dispatcher: { select: { name: true, phone: true } },
        stops: { orderBy: { seq: "asc" } },
        events: { orderBy: { createdAt: "desc" }, take: 5, include: { user: { select: { name: true } } } },
      },
    }),
    db.load.findMany({
      where: { driverId, status: "ASSIGNED" },
      orderBy: { pickupAt: "asc" },
      include: { customer: { select: { name: true } }, _count: { select: { stops: true } } },
    }),
    db.load.findMany({ where: { driverId, status: { in: DONE_STATUSES } }, orderBy: { deliveredAt: "desc" }, take: 5 }),
    db.load.aggregate({ where: { driverId, status: { in: DONE_STATUSES }, deliveredAt: { gte: weekStart } }, _sum: { driverPay: true, distanceKm: true }, _count: true }),
    db.load.aggregate({ where: { driverId, status: { in: DONE_STATUSES }, deliveredAt: { gte: monthStart } }, _sum: { driverPay: true, distanceKm: true }, _count: true }),
    db.announcement.findFirst({
      where: { pinned: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    driver.truck ? db.fuelLog.findFirst({ where: { truckId: driver.truck.id }, orderBy: { date: "desc" } }) : Promise.resolve(null),
  ]);

  const truck = driver.truck;
  const next = upcoming.filter((l) => l.id !== active?.id);
  const inTransit = active?.status === "IN_TRANSIT";
  const nextStop = active?.stops.find((s) => s.status !== "DONE") ?? null;
  const stopsDone = active?.stops.filter((s) => s.status === "DONE").length ?? 0;
  const progress = active && inTransit ? loadProgress(active) : 0;
  const eta = active && inTransit ? estimatedArrival(active) : null;
  const lateMs = active && eta ? eta.getTime() - active.deliveryAt.getTime() : 0;
  const remainingKm = active ? Math.max(0, Math.round(active.distanceKm * (1 - progress))) : 0;
  const pingStale = !truck?.lastPingAt || now.getTime() - truck.lastPingAt.getTime() > STALE_PING_MS;

  const points: MapPoint[] = active
    ? active.stops.length
      ? active.stops.map((s, i) => ({
          lat: s.lat, lng: s.lng, index: s.seq, done: s.status === "DONE",
          kind: i === 0 ? "origin" : i === active.stops.length - 1 ? "dest" : "stop",
          label: `${s.seq}. ${STOP_TYPE_LABEL[s.type] ?? s.type}: ${s.name}, ${s.city}`,
        }))
      : [
          { lat: active.originLat, lng: active.originLng, kind: "origin", label: `Pickup: ${active.originName}` },
          { lat: active.destLat, lng: active.destLng, kind: "dest", label: `Delivery: ${active.destName}` },
        ]
    : [];
  const truckMarker: MapTruck | null = active && inTransit && truck && truck.lat != null && truck.lng != null
    ? {
        id: truck.id, unitNumber: truck.unitNumber, lat: truck.lat, lng: truck.lng, heading: truck.heading ?? 0, speedKmh: truck.speedKmh ?? 0,
        status: truck.status, driverName: driver.name, moving: (truck.speedKmh ?? 0) > 1, stale: pingStale, route: loadRoute(active),
        label: `${active.reference}: ${active.originCity} → ${active.destCity}`,
      }
    : null;

  const firstName = driver.name.split(/\s+/)[0];
  const boardLabel = BOARD_STATUS_LABELS[driver.boardStatus as BoardStatus] ?? driver.boardStatus;
  const statusSince = sinceLabel(driver.boardStatusSince, now);
  const heldByDispatch = isDispatchHeld(driver.boardStatus);
  const bigInput = "h-11 text-[15px]";

  return (
    <div className="mx-auto max-w-2xl space-y-4 text-[15px]">
      {/* Greeting ------------------------------------------------------- */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-fg">{greetingFor(localHour(now))}, {firstName}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[14px] text-fg-muted">
            <Truck className="h-4 w-4 text-fg-subtle" />
            {truck ? (
              <>Truck <span className="num font-medium text-fg">{truck.unitNumber}</span> · <span className="num">{truck.plate}</span></>
            ) : (
              <span>No truck assigned</span>
            )}
            {driver.team && <span className="text-fg-subtle">· {driver.team.name}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Badge value={driver.boardStatus} label={boardLabel} dot className="px-2 py-1 text-[12px]" />
          <p className="num mt-1 text-[11px] text-fg-subtle">{statusSince}</p>
        </div>
      </header>

      {announcement && (
        <AnnouncementBanner id={announcement.id} title={announcement.title} body={announcement.body}
          meta={`${announcement.author?.name ?? "Office"} · ${date(announcement.createdAt)}`} />
      )}

      <StatusToggle status={driver.boardStatus} since={statusSince} onTrip={Boolean(inTransit)} />

      {truck ? (
        <GpsShare unitNumber={truck.unitNumber} />
      ) : (
        <Card>
          <EmptyState icon={<Truck />} title="No truck assigned"
            description="Ask your fleet manager to assign you a unit. Location sharing and fuel logging turn on as soon as you have one." />
        </Card>
      )}

      {/* Current trip ---------------------------------------------------- */}
      {active ? (
        <Card flush className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="eyebrow">Current trip</p>
              <p className="num mt-0.5 text-[17px] font-semibold leading-6 text-fg">{active.reference}</p>
              <p className="text-[13px] text-fg-muted">
                {active.originCity} → {active.destCity} · <span className="num">{km(active.distanceKm)}</span> · {active.stops.length} stops
              </p>
            </div>
            <Badge value={active.status} label={LOAD_STATUS_LABELS[active.status as LoadStatus]} dot className="mt-0.5 shrink-0" />
          </div>

          {/* Customer and cargo */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
            <div className="col-span-2 min-w-0">
              <dt className="text-[11px] text-fg-subtle">Customer</dt>
              <dd className="truncate text-[14px] font-medium text-fg">
                {active.customer.name}
                {active.customerRef && <> <span className="num ml-1 text-[12px] font-normal text-fg-subtle">ref {active.customerRef}</span></>}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-fg-subtle">Commodity</dt>
              <dd className="truncate text-[14px] font-medium text-fg">{active.commodity}</dd>
              <dd className="num text-[12px] text-fg-muted">{kg(active.weightKg)}{active.pallets ? ` · ${active.pallets} pallets` : ""}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-fg-subtle">Equipment</dt>
              <dd className="truncate text-[14px] font-medium text-fg">
                {EQUIPMENT_LABELS[active.equipment] ?? active.equipment}{active.trailer && <span className="num"> · {active.trailer.unitNumber}</span>}
              </dd>
              <dd className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {active.temperatureC != null ? (
                  <Chip tone="info" className="gap-1 normal-case tracking-normal"><Thermometer className="h-3 w-3" />Keep at {active.temperatureC} °C</Chip>
                ) : (
                  <span className="text-[12px] text-fg-muted">Ambient</span>
                )}
                {active.hazmat && <Chip tone="danger" title="ADR rules apply">Hazmat</Chip>}
              </dd>
            </div>
          </dl>
          {active.notes && (
            <div className="mx-4 mb-3 rounded-md bg-warn-soft px-3 py-2">
              <p className="eyebrow mb-0.5">Instructions</p>
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">{active.notes}</p>
            </div>
          )}

          {/* Dispatcher */}
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-fg-subtle">Dispatcher</p>
              <p className="truncate text-[14px] font-medium text-fg">{active.dispatcher?.name ?? "Dispatch desk"}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {active.dispatcher?.phone && (
                <a href={`tel:${active.dispatcher.phone.replace(/\s+/g, "")}`} className={cn(buttonClass("secondary"), "h-11 px-3.5 text-[14px]")}>
                  <Phone />Call
                </a>
              )}
              <LinkButton href={chatRoomHref(active.id)} variant="secondary" aria-label="Chat with dispatch" className="h-11 px-3.5 text-[14px]"><MessageSquare />Chat</LinkButton>
            </div>
          </div>

          {/* Progress and ETA (in transit) */}
          {inTransit && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between text-[12px]">
                <span className="font-medium text-fg">Trip progress</span>
                <span className="num text-fg-muted">{Math.round(progress * 100)}% · {number(remainingKm)} km to go</span>
              </div>
              <Progress value={progress} />
              {/* Two columns on a phone (times never clipped), three from sm up. */}
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-fg-subtle">ETA</p>
                  <p className="num text-[13px] font-medium text-fg">{eta ? dateTime(eta) : "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-fg-subtle">Deliver by</p>
                  <p className="num text-[13px] font-medium text-fg">{dateTime(active.deliveryAt)}</p>
                </div>
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <p className="text-[11px] text-fg-subtle">Schedule</p>
                  <p className={cn("text-[13px] font-medium", lateMs > 0 ? "text-danger" : "text-ok")}>{lateMs > 0 ? `${fmtDuration(lateMs)} late` : "On time"}</p>
                </div>
              </div>
            </div>
          )}

          {/* Start trip (before departure) */}
          {active.status === "ASSIGNED" && (
            <div className="border-t border-line px-4 py-3">
              <p className="text-[13px] text-fg-muted">
                Pickup <span className="num font-medium text-fg">{dateTime(active.pickupAt)}</span> at {active.originName} <span className="text-fg-subtle">· {ago(active.pickupAt)}</span>
              </p>
              <ActionForm action={driverUpdateLoad.bind(null, active.id)} className="mt-2.5"
                confirm="Loaded and leaving the pickup? This marks the pickup done and puts you en route on the dispatch board.">
                <input type="hidden" name="status" value="IN_TRANSIT" />
                <GeoFields />
                <SubmitButton variant="accent" className="h-12 w-full text-[15px]" pendingText="Starting trip…"><Navigation />Start trip</SubmitButton>
              </ActionForm>
            </div>
          )}

          {/* Route map */}
          <div className="border-t border-line p-2">
            <LeafletMap height={240} fitKey={active.id} points={points} trucks={truckMarker ? [truckMarker] : []} />
            {truckMarker && truck && (
              <p className="num mt-1.5 flex flex-wrap items-center gap-x-1.5 px-2 text-[11px] text-fg-subtle">
                <span className="text-fg-muted">{truck.unitNumber}</span>
                · {Math.round(truck.speedKmh ?? 0)} km/h
                {truck.locationName && <> · near {truck.locationName}</>}
                · fix {ago(truck.lastPingAt)}{truck.pingSource === "DEVICE" ? " (phone)" : ""}
              </p>
            )}
          </div>

          {/* Stops */}
          <div className="border-t border-line">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h3 className="text-[13px] font-semibold text-fg">Stops</h3>
              <span className="num text-[12px] text-fg-subtle">{stopsDone}/{active.stops.length} done</span>
            </div>
            {active.stops.length === 0 ? (
              <EmptyState title="No stops on this load" description="Dispatch has not added stops yet — the route above shows pickup and delivery." />
            ) : (
              <ol className="divide-y divide-line">
                {active.stops.map((s, i) => {
                  const isNext = inTransit && nextStop?.id === s.id;
                  const isLast = i === active.stops.length - 1;
                  const finalDelivery = isLast && s.type === "DELIVERY";
                  const done = s.status === "DONE";
                  return (
                    <li key={s.id} className={cn("px-4 py-3", isNext && "bg-accent-soft/40")} aria-current={isNext ? "step" : undefined}>
                      <div className="flex items-start gap-3">
                        <span className={cn(
                          "num mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                          done ? "bg-ok-soft text-ok" : s.status === "ARRIVED" ? "bg-info-soft text-info" : isNext ? "bg-accent text-on-accent" : "bg-sunken text-fg-muted",
                        )}>
                          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.seq}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip tone={STOP_TYPE_TONE[s.type] ?? "neutral"}>{STOP_TYPE_LABEL[s.type] ?? s.type}</Chip>
                            {isNext && <Chip tone="accent">Next</Chip>}
                            <Badge value={s.status} tone={STOP_TONE[s.status] ?? "neutral"} className="ml-auto" />
                          </div>
                          <p className={cn("mt-1 text-[15px] font-medium leading-5", done ? "text-fg-muted" : "text-fg")}>{s.name}</p>
                          <p className="text-[13px] text-fg-muted">{s.city}{s.address && ` · ${s.address}`}</p>
                          <p className="num mt-0.5 flex items-center gap-1 text-[12px] text-fg-subtle">
                            <Clock className="h-3 w-3" />
                            {done
                              ? `Arrived ${dateTime(s.arrivedAt)} · left ${dateTime(s.departedAt)}`
                              : s.status === "ARRIVED"
                                ? `Arrived ${dateTime(s.arrivedAt)} · window ${windowLabel(s.windowStart, s.windowEnd)}`
                                : windowLabel(s.windowStart, s.windowEnd)}
                          </p>
                          {s.notes && !done && <p className="mt-1 text-[12px] leading-4 text-fg-muted">{s.notes}</p>}
                        </div>
                      </div>

                      {!done && (
                        <div className="mt-3 flex flex-wrap gap-2 pl-10">
                          <a href={navigateUrl(s.lat, s.lng)} target="_blank" rel="noreferrer"
                            className={cn(buttonClass("secondary"), "h-11 min-w-[8rem] flex-1 text-[14px]")}>
                            <Navigation />Navigate
                          </a>
                          {isNext && <StopActions loadId={active.id} stopId={s.id} status={s.status} type={s.type} allowComplete={!finalDelivery} />}
                        </div>
                      )}

                      {isNext && finalDelivery && (
                        <ActionForm action={driverUpdateLoad.bind(null, active.id)} confirm="Confirm the load has been delivered? Dispatch and billing are notified."
                          className="mt-3 rounded-md border border-line bg-surface p-3 sm:ml-10">
                          <input type="hidden" name="status" value="DELIVERED" />
                          <GeoFields />
                          <p className="text-[13px] font-semibold text-fg">Proof of delivery</p>
                          <p className="mt-0.5 text-[12px] leading-4 text-fg-muted">Enter who signed for the goods, then confirm. Photograph the signed POD below so billing can invoice.</p>
                          <Field label="Signed by" required className="mt-2.5">
                            <Input name="podSignedBy" required placeholder="Receiver's full name" autoComplete="off" className={bigInput} />
                          </Field>
                          <SubmitButton variant="accent" className="mt-3 h-12 w-full text-[15px]" pendingText="Confirming…"><Check />Confirm delivery</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Trip documents */}
          <div className="border-t border-line px-4 py-3">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
              Trip documents<InfoTip>Photograph the signed POD, CMR or BOL: dispatch and billing see it straight away.</InfoTip>
            </h3>
            {/* The POD is the driver's share of the billing checklist (the rate confirmation is the office's); it only applies once the trip is under way. */}
            <DocumentsPanel user={user} target={{ type: "load", id: active.id }} path="/driver" camera plain defaultKind={inTransit ? "POD" : "BOL"}
              required={inTransit ? ["POD"] : undefined} />
          </div>

          {/* Send update + recent events */}
          <div className="border-t border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold text-fg">Send update to dispatch</h3>
            <ActionForm action={addLoadEvent.bind(null, active.id)} resetOnSuccess className="mt-2 space-y-2">
              <fieldset className="grid grid-cols-3 gap-1 rounded-md bg-sunken p-1">
                <legend className="sr-only">Update type</legend>
                {UPDATE_TYPES.map((t, i) => (
                  <label key={t.value} className="cursor-pointer">
                    <input type="radio" name="type" value={t.value} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="flex h-11 items-center justify-center rounded text-[13px] font-medium text-fg-muted transition-colors hover:text-fg peer-checked:bg-surface peer-checked:text-fg peer-checked:ring-1 peer-checked:ring-line-strong peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                      {t.label}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex gap-2">
                <Input name="message" required placeholder={UPDATE_TYPES[0].placeholder} aria-label="Message" className={bigInput} />
                <SubmitButton className="h-11 shrink-0 px-4 text-[14px]" pendingText="Sending…"><Send />Send</SubmitButton>
              </div>
            </ActionForm>
            {active.events.length > 0 && (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {active.events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 py-2">
                    {e.type === "ISSUE"
                      ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                      : <Chip tone={EVENT_TONE[e.type] ?? "neutral"} className="mt-0.5 shrink-0">{EVENT_LABEL[e.type] ?? e.type}</Chip>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-5 text-fg">{e.message}</p>
                      <p className="num text-[11px] text-fg-subtle">{dateTime(e.createdAt)}{e.user && ` · ${e.user.name}`}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<Package />} title="No trip assigned"
            description={heldByDispatch
              ? "Dispatch will put your next trip here once they set you back to Ready."
              : "Dispatch will put your next trip here. Keep your status on Ready so they know you are available."}
            action={<LinkButton href="/chat" variant="secondary" className="h-11 px-4 text-[14px]"><MessageSquare />Chat with dispatch</LinkButton>} />
        </Card>
      )}

      {/* Next trips -------------------------------------------------------- */}
      {next.length > 0 && (
        <Card title="Next trips" flush actions={<span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{next.length}</span>}>
          <ul className="divide-y divide-line">
            {next.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span className="num font-semibold text-fg">{l.reference}</span>
                    <span className="truncate text-fg-muted">{l.customer.name}</span>
                  </p>
                  <p className="text-[14px] font-medium text-fg">{l.originCity} → {l.destCity}</p>
                  <p className="num text-[12px] text-fg-subtle">
                    Pickup {dateTime(l.pickupAt)} · {km(l.distanceKm)} · {l._count.stops} stops · <span className="font-sans">{l.commodity}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[14px] font-medium text-fg">{money(l.driverPay)}</p>
                  <p className="text-[11px] text-fg-subtle">{ago(l.pickupAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Production -------------------------------------------------------- */}
      <section aria-label="My production">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-fg">This week</h2>
          <p className="num text-[11px] text-fg-subtle">from {date(weekStart)}</p>
        </div>
        {/* Two tiles a row on a phone (22px values need ~140px each), earnings full width; three across from sm up. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Loads" value={week._count} />
          <Stat label="Distance" value={km(week._sum.distanceKm)} />
          <Stat label="Earnings" value={money(week._sum.driverPay)} tone="ok" className="col-span-2 sm:col-span-1" />
        </div>
        {/* Month totals stay on screen: tile hints only show on hover, and this page is used on a phone. */}
        <p className="num mt-2 px-1 text-[12px] text-fg-muted">
          <span className="font-sans font-medium text-fg">This month</span> · {month._count} loads · {km(month._sum.distanceKm)} · {money(month._sum.driverPay)} · ${driver.payPerKm.toFixed(2)}/km
        </p>
      </section>

      {/* Fuel -------------------------------------------------------------- */}
      {truck && (
        <Card title="Log fuel" actions={<span className="num text-[11px] text-fg-subtle">{truck.unitNumber} · {number(truck.odometerKm)} km</span>}>
          <ActionForm action={addFuelLog.bind(null, truck.id)} resetOnSuccess className="grid grid-cols-2 gap-3">
            <Field label="Liters" required><Input name="liters" type="number" step="0.1" min="1" required inputMode="decimal" placeholder="0.0" className={bigInput} /></Field>
            <Field label="Cost (USD)" required><Input name="cost" type="number" step="0.01" min="0.01" required inputMode="decimal" placeholder="0.00" className={bigInput} /></Field>
            <Field label="Odometer (km)"><Input name="odometerKm" type="number" inputMode="numeric" placeholder={String(truck.odometerKm)} className={bigInput} /></Field>
            <Field label="Station"><Input name="station" placeholder="e.g. UzGasOil, Jizzakh" className={bigInput} /></Field>
            <SubmitButton variant="secondary" className="col-span-2 h-11 text-[14px]" pendingText="Saving…"><Fuel />Save fuel entry</SubmitButton>
          </ActionForm>
          <p className="num mt-3 text-[11px] text-fg-subtle">
            {lastFuel
              ? <>Last entry {ago(lastFuel.date)}: {number(lastFuel.liters)} L · {money(lastFuel.cost)}{lastFuel.station && <span className="font-sans"> · {lastFuel.station}</span>}</>
              : "No fuel entries yet — log each fill-up so fuel cost per km stays accurate."}
          </p>
        </Card>
      )}

      {/* Recently delivered ----------------------------------------------- */}
      <Card title="Recently delivered" flush>
        {recent.length === 0 ? (
          <EmptyState title="No deliveries yet" description="Completed trips and what they paid will show here." />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[14px]">
                    <span className="num font-semibold text-fg">{l.reference}</span>
                    <span className="truncate text-fg-muted">{l.originCity} → {l.destCity}</span>
                  </p>
                  <p className="num text-[12px] text-fg-subtle">
                    {date(l.deliveredAt)} · {km(l.distanceKm)}{l.podSignedBy && <span className="font-sans"> · POD {l.podSignedBy}</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[14px] font-medium text-ok">{money(l.driverPay)}</p>
                  <Badge value={l.status} label={LOAD_STATUS_LABELS[l.status as LoadStatus]} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
