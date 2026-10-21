import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { FileText, Mail, MessageSquare, Pencil, Phone, ShieldAlert, Thermometer } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  BILLING_STAGE_LABELS, CLAIM_TYPE_LABELS, CUSTOMER_KIND_LABELS, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, LOAD_TRANSITIONS,
  humanize, type BillingStage, type LoadStatus,
} from "@/lib/constants";
import { missingLoadDocs } from "@/lib/workflow";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { ago, date, dateTime, kg, money, number } from "@/lib/format";
import { estimatedArrival, loadProgress, loadRoute, syncSimulatedPositions } from "@/lib/telemetry";
import { setLoadStatus } from "@/app/actions/loads";
import { invoiceLoad } from "@/app/actions/finance";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Chip, DL, Disclosure, InfoTip, LinkButton, LiveDot, PageHeader, Progress, STATUS_TONE, StatusDot, buttonClass, cardClass, cn } from "@/components/ui";
import { LeafletMap, type MapPoint, type MapTruck } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { ChatThread } from "@/components/chat/thread";
import { assignmentOptions } from "../options";
import { LoadRowMenu } from "../row-menu";
import { PRIORITY_TONE, STOP_TONE, STOP_TYPE_LABEL, STOP_TYPE_TONE, fmtDuration, fmtRpk, loadSteps, pingStale, ratePerKm, stopLateBy, windowLabel } from "../shared";
import { LoadStepper } from "./stepper";
import { LoadActivity, type ActivityEvent } from "./activity";
import { StopActions } from "./stop-actions";
import { StatusActions } from "./status-actions";
import { AssignForm, RecoverForm } from "./assignment";
import { DeleteLoadButton } from "./delete-button";
import { RecoverDetails } from "./recover-details";

/** Checklist shown on the documents card (REQUIRED_LOAD_DOCS drives the billing stage; BOL is expected on file too). */
const LOAD_DOC_CHECKLIST = ["RC", "BOL", "POD"] as const;

export async function generateMetadata({ params }: PageProps<"/loads/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.load.findUnique({ where: { id: (await params).id }, select: { reference: true } });
  return { title: r?.reference ?? "Not found" };
}

export default async function LoadDetail({ params }: PageProps<"/loads/[id]">) {
  const user = await requireUser("loads.view");
  const { id } = await params;
  await syncSimulatedPositions();
  const load = await db.load.findUnique({
    where: { id },
    include: {
      customer: true,
      broker: true,
      team: { select: { id: true, name: true } },
      truck: true,
      trailer: { select: { id: true, unitNumber: true, type: true, status: true } },
      driver: { select: { id: true, name: true, phone: true, boardStatus: true, hold: true, payPerKm: true } },
      dispatcher: { select: { name: true } },
      invoice: true,
      stops: { orderBy: { seq: "asc" } },
      events: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      documents: { select: { kind: true } },
      claims: { select: { id: true, number: true, status: true, type: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!load) notFound();

  const editable = can(user.role, "loads.edit");
  const showMoney = can(user.role, "finance.view") || editable;
  const canFinance = can(user.role, "finance.edit");
  const canClaim = can(user.role, "claims.edit");
  const status = load.status as LoadStatus;
  const stage = load.billingStage as BillingStage;
  const transitions = LOAD_TRANSITIONS[status];
  const inTransit = status === "IN_TRANSIT";
  const delivered = status === "DELIVERED" || status === "INVOICED";
  const opts = editable && ["PLANNED", "ASSIGNED", "IN_TRANSIT"].includes(status) ? await assignmentOptions(id) : null;

  const { steps, terminal } = loadSteps(load);
  const progress = inTransit ? loadProgress(load) : delivered ? 1 : 0;
  const eta = inTransit ? estimatedArrival(load) : null;
  const lateMs = load.deliveredAt ? load.deliveredAt.getTime() - load.deliveryAt.getTime() : eta ? eta.getTime() - load.deliveryAt.getTime() : 0;
  const late = lateMs > 0;
  const nextStop = load.stops.find((s) => s.status !== "DONE") ?? null;
  const missing = missingLoadDocs(load.documents, load.status);
  const docLabel = (k: string) => (DOC_KIND_LABELS[k] ?? k).toLowerCase();

  const cost = load.driverPay + load.fuelCost + load.otherCost;
  const margin = load.rate - cost;
  const marginPct = load.rate ? Math.round((margin / load.rate) * 100) : 0;
  const rpk = ratePerKm(load.rate, load.distanceKm, load.emptyKm);
  const billTo = load.broker ?? load.customer;

  const points: MapPoint[] = load.stops.length
    ? load.stops.map((s, i) => ({
        lat: s.lat, lng: s.lng, index: s.seq, done: s.status === "DONE",
        kind: i === 0 ? "origin" : i === load.stops.length - 1 ? "dest" : "stop",
        label: `${s.seq}. ${STOP_TYPE_LABEL[s.type] ?? s.type}: ${s.name}, ${s.city}`,
      }))
    : [
        { lat: load.originLat, lng: load.originLng, kind: "origin", label: `Pickup: ${load.originName}` },
        { lat: load.destLat, lng: load.destLng, kind: "dest", label: `Delivery: ${load.destName}` },
      ];
  const t = load.truck;
  const stale = pingStale(t?.lastPingAt);
  const truckMarker: MapTruck | null = inTransit && t && t.lat != null && t.lng != null
    ? {
        id: t.id, unitNumber: t.unitNumber, lat: t.lat, lng: t.lng, heading: t.heading ?? 0, speedKmh: t.speedKmh ?? 0, status: t.status,
        driverName: load.driver?.name, moving: (t.speedKmh ?? 0) > 1, stale, route: loadRoute(load),
        label: `${load.reference}: ${load.originCity} → ${load.destCity}`,
      }
    : null;

  const events: ActivityEvent[] = load.events.map((e) => ({ id: e.id, type: e.type, message: e.message, user: e.user?.name ?? null, at: dateTime(e.createdAt), ago: ago(e.createdAt) }));
  const unitOptions = opts ? { trucks: opts.trucks, drivers: opts.drivers, trailers: opts.trailers } : null;
  const current = { truckId: load.truckId, driverId: load.driverId, trailerId: load.trailerId };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/loads" className="hover:text-fg">Loads</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{load.reference}</span>
            <Badge value={status} label={LOAD_STATUS_LABELS[status]} dot />
            {stage !== "NONE" && <Chip tone={STATUS_TONE[stage] ?? "neutral"}>{BILLING_STAGE_LABELS[stage]}</Chip>}
            {load.priority !== "NORMAL" && <Chip tone={PRIORITY_TONE[load.priority]}>{humanize(load.priority)}</Chip>}
            {load.hazmat && <Chip tone="danger">Hazmat</Chip>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <Link href={`/customers/${load.customer.id}`} className="font-medium text-fg hover:underline">{load.customer.name}</Link>
              {load.broker && <> via <Link href={`/customers/${load.broker.id}`} className="text-fg hover:underline">{load.broker.name}</Link></>}
            </span>
            {load.customerRef && <span>Ref <span className="num text-fg">{load.customerRef}</span></span>}
            {load.team && <span>{load.team.name.toLowerCase().startsWith("team") ? load.team.name : `Team ${load.team.name}`}</span>}
            <InfoTip>Booked by {load.dispatcher?.name ?? "—"} · created {dateTime(load.createdAt)} ({ago(load.createdAt)}){load.team ? "" : " · no team"}</InfoTip>
          </span>
        }
        actions={
          <>
            <LinkButton href={`/chat?room=load:${id}`} variant="secondary"><MessageSquare />Open in chat</LinkButton>
            {editable && status !== "INVOICED" && <LinkButton href={`/loads/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>}
            <LoadRowMenu id={id} reference={load.reference} status={status} canEdit={editable} canClaim={canClaim} trigger="button" context="detail" />
          </>
        }
      />

      <LoadStepper steps={steps} terminal={terminal} className="mb-4" />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---------------------------------------------------------- left */}
        <div className="space-y-4 xl:col-span-2">
          <Card
            title="Route" flush
            actions={
              <span className="flex items-center gap-3">
                {inTransit && <LiveDot />}
                <span className="num text-[11px] text-fg-subtle">
                  {number(load.distanceKm)} km loaded{load.emptyKm > 0 && ` · ${number(load.emptyKm)} km empty`} · {load.stops.length} stops
                </span>
              </span>
            }
          >
            <div className="p-2">
              <LeafletMap height={280} fitKey={id} points={points} trucks={truckMarker ? [truckMarker] : []} />
            </div>

            {inTransit && (
              <div className="border-y border-line px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
                  <span className="text-fg-muted">
                    {t ? (
                      <>
                        <span className="num font-medium text-fg">{t.unitNumber}</span>
                        {t.locationName && <> near {t.locationName}</>} · <span className="num">{Math.round(t.speedKmh ?? 0)} km/h</span>
                        {" · "}<span className={cn(stale && "text-warn")}>ping {ago(t.lastPingAt)}</span>
                      </>
                    ) : "No truck position"}
                  </span>
                  <span className={cn("num", late ? "text-danger" : "text-fg-muted")}>
                    ETA {dateTime(eta)}{eta && (late ? ` · ${fmtDuration(lateMs)} late` : ` · ${fmtDuration(-lateMs)} buffer`)}
                  </span>
                </div>
                <Progress value={progress} tone={late ? "danger" : "progress"} className="mt-2" />
                <div className="mt-1 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>Departed <span className="num">{dateTime(load.departedAt)}</span></span>
                  <span className="num">{Math.round(progress * 100)}% · due {dateTime(load.deliveryAt)}</span>
                </div>
              </div>
            )}

            {delivered && load.deliveredAt && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line px-4 py-2 text-[12px]">
                <span className="text-fg-muted">
                  Delivered <span className="num text-fg">{dateTime(load.deliveredAt)}</span>
                  {load.podSignedBy && <> · POD signed by <span className="text-fg">{load.podSignedBy}</span></>}
                </span>
                <span className={cn("font-medium", late ? "text-danger" : "text-ok")}>{late ? `${fmtDuration(lateMs)} late` : "On time"}</span>
              </div>
            )}

            {!inTransit && !delivered && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line px-4 py-2 text-[12px] text-fg-muted">
                <span>Pickup <span className="num text-fg">{dateTime(load.pickupAt)}</span> · {ago(load.pickupAt)}</span>
                <span>Deliver by <span className="num text-fg">{dateTime(load.deliveryAt)}</span></span>
              </div>
            )}

            <ol className="divide-y divide-line">
              {load.stops.map((s, i) => {
                const isNext = inTransit && nextStop?.id === s.id;
                const lateBy = stopLateBy(s);
                const dwell = s.arrivedAt && s.departedAt ? s.departedAt.getTime() - s.arrivedAt.getTime() : null;
                return (
                  <li key={s.id} className={cn("flex items-start gap-3 px-4 py-2.5", isNext && "bg-accent-soft/40")}>
                    <span className={cn(
                      "num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      s.status === "DONE" ? "bg-ok-soft text-ok" : s.status === "ARRIVED" ? "bg-info-soft text-info" : "bg-sunken text-fg-muted",
                    )}>{s.seq}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={STOP_TYPE_TONE[s.type] ?? "neutral"}>{STOP_TYPE_LABEL[s.type] ?? s.type}</Chip>
                        <span className={cn("truncate text-[13px] font-medium", s.status === "DONE" ? "text-fg-muted" : "text-fg")}>{s.name}</span>
                        {isNext && <Chip tone="accent">Next</Chip>}
                        {lateBy != null && <Chip tone="danger">Late {fmtDuration(lateBy)}</Chip>}
                      </div>
                      <p className="truncate text-[11px] text-fg-subtle">
                        {s.city}{s.address && ` · ${s.address}`}{s.notes && ` · ${s.notes}`}
                      </p>
                      <p className="num text-[11px] text-fg-subtle sm:hidden">{windowLabel(s.windowStart, s.windowEnd)}</p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="num text-[12px] text-fg-muted">{windowLabel(s.windowStart, s.windowEnd)}</p>
                      <p className="num text-[11px] text-fg-subtle">
                        {s.arrivedAt ? `Arrived ${dateTime(s.arrivedAt)}` : ""}
                        {s.departedAt ? `${s.arrivedAt ? " · " : ""}Departed ${dateTime(s.departedAt)}` : ""}
                        {dwell != null && dwell > 60_000 ? ` · ${fmtDuration(dwell)} on site` : ""}
                      </p>
                    </div>
                    <Badge value={s.status} tone={STOP_TONE[s.status] ?? "neutral"} className="mt-0.5 shrink-0" />
                    {editable && inTransit && s.status !== "DONE" && (
                      <StopActions loadId={id} stopId={s.id} status={s.status} isLast={i === load.stops.length - 1} />
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title="Cargo">
            <DL cols={3} items={[
              ["Commodity", load.commodity],
              ["Equipment", EQUIPMENT_LABELS[load.equipment] ?? load.equipment],
              ["Weight", kg(load.weightKg)],
              ["Pallets", load.pallets != null ? number(load.pallets) : "—"],
              ["Temperature", load.temperatureC != null
                ? <span key="t" className="num inline-flex items-center gap-1"><Thermometer className="h-3.5 w-3.5 text-info" />{load.temperatureC} °C</span>
                : "Ambient"],
              ["Hazmat", load.hazmat ? <span key="h" className="text-danger">Yes — ADR paperwork required</span> : "No"],
              ["Customer reference", load.customerRef ? <span key="r" className="num">{load.customerRef}</span> : "—"],
              ["Distance", <span key="d" className="num">{number(load.distanceKm)} km loaded · {number(load.emptyKm)} km empty</span>],
              ["Trailer type", load.trailer ? EQUIPMENT_LABELS[load.trailer.type] ?? load.trailer.type : "—"],
            ]} />
            {load.notes && (
              <div className="mt-4 rounded-md bg-sunken/60 px-3 py-2">
                <p className="eyebrow mb-1">Notes and instructions</p>
                <p className="whitespace-pre-wrap text-[13px] text-fg">{load.notes}</p>
              </div>
            )}
          </Card>

          <DocumentsPanel
            user={user} target={{ type: "load", id }} path={`/loads/${id}`} required={LOAD_DOC_CHECKLIST}
            defaultKind={delivered || status === "TONU" ? "POD" : "RC"}
            description={
              stage === "NONE"
                ? `Billing starts after delivery. ${missing.length ? `Still to collect: ${missing.map(docLabel).join(", ")}.` : "The required paperwork is already on file."}`
                : stage === "MISSING_DOCS"
                  ? `Billing stage: missing docs — upload the ${missing.map(docLabel).join(" and ")} to make this load ready to invoice.`
                  : `Billing stage: ${BILLING_STAGE_LABELS[stage].toLowerCase()}.${missing.length ? ` Missing ${missing.map(docLabel).join(", ")}.` : ""}`
            }
          />

          <Card title="Activity" flush actions={<span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{events.length}</span>}>
            <LoadActivity loadId={id} events={events} canPost />
          </Card>

          <section className={cardClass}>
            <Disclosure title="Thread" icon={<MessageSquare />} className="[&>summary]:rounded-lg [&>summary]:py-3"
              meta={<Link href={`/chat?room=load:${id}`} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open in chat</Link>}>
              <div className="border-t border-line"><ChatThread room={`load:${id}`} compact className="h-80" /></div>
            </Disclosure>
          </section>
        </div>

        {/* --------------------------------------------------------- right */}
        <div className="space-y-4">
          <div id="assign" className="scroll-mt-16" />
          <Card
            title="Assignment"
            actions={load.driver?.phone && (
              <a href={`tel:${load.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg">
                <Phone className="h-3.5 w-3.5" />Call driver
              </a>
            )}
          >
            {load.truck || load.driver ? (
              <dl className="space-y-2.5 text-[13px]">
                <Row label="Truck">
                  {load.truck ? (
                    <>
                      <Link href={`/fleet/${load.truck.id}`} className="num font-medium text-fg hover:underline">{load.truck.unitNumber}</Link>
                      <span className="text-fg-subtle"> · {load.truck.make} {load.truck.model}</span>
                    </>
                  ) : <span className="text-fg-faint">—</span>}
                </Row>
                <Row label="Trailer">
                  {load.trailer ? (
                    <>
                      <Link href={`/fleet/trailers/${load.trailer.id}`} className="num font-medium text-fg hover:underline">{load.trailer.unitNumber}</Link>
                      <span className="text-fg-subtle"> · {EQUIPMENT_LABELS[load.trailer.type] ?? load.trailer.type}</span>
                    </>
                  ) : <span className="text-fg-faint">None</span>}
                </Row>
                <Row label="Driver">
                  {load.driver ? (
                    <span className="flex flex-col items-end">
                      <span className="flex items-center gap-1.5">
                        <Link href={`/drivers/${load.driver.id}`} className="font-medium text-fg hover:underline">{load.driver.name}</Link>
                        <Badge value={load.driver.boardStatus} />
                        {load.driver.hold && <Chip tone="warn">Hold</Chip>}
                      </span>
                      {load.driver.phone && <span className="num text-[11px] text-fg-subtle">{load.driver.phone}</span>}
                    </span>
                  ) : <span className="text-fg-faint">—</span>}
                </Row>
              </dl>
            ) : status === "PLANNED" ? (
              <p className="flex items-center gap-2 text-[13px] text-warn">
                <StatusDot tone="warn" />
                Needs a truck and driver{editable ? " — assign below to dispatch." : "."}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-fg-muted">
                <StatusDot tone="neutral" />
                No unit was assigned to this load.
              </p>
            )}

            {unitOptions && (status === "PLANNED" || status === "ASSIGNED") && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2">{load.truckId ? "Reassign" : "Assign"}</p>
                <AssignForm loadId={id} options={unitOptions} current={current} distanceKm={load.distanceKm} />
              </div>
            )}

            {unitOptions && (status === "ASSIGNED" || status === "IN_TRANSIT") && (
              <RecoverDetails defaultOpen={false} summary={
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block transition-transform group-open:rotate-90">›</span>Recover to another unit
                  <span className="normal-case tracking-normal text-fg-faint">· breakdown, HOS, swap</span>
                </span>
              }>
                <RecoverForm loadId={id} options={unitOptions} current={current} />
              </RecoverDetails>
            )}
          </Card>

          {editable && (
            <Card title="Status">
              <StatusActions loadId={id} reference={load.reference} status={status} transitions={transitions} />
            </Card>
          )}

          {showMoney && (
            <Card title="Financials" actions={stage !== "NONE" && <Chip tone={STATUS_TONE[stage] ?? "neutral"}>{BILLING_STAGE_LABELS[stage]}</Chip>}>
              <dl className="space-y-1.5 text-[13px]">
                <Row label="Customer rate"><span className="num font-semibold text-fg">{money(load.rate)}</span></Row>
                <Row label="Driver pay"><span className="num text-fg-muted">−{money(load.driverPay)}</span></Row>
                <Row label="Fuel"><span className="num text-fg-muted">−{money(load.fuelCost)}</span></Row>
                <Row label="Other"><span className="num text-fg-muted">−{money(load.otherCost)}</span></Row>
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <dt className="font-medium text-fg">Margin</dt>
                  <dd className={cn("num font-semibold", margin < 0 ? "text-danger" : marginPct < 15 ? "text-warn" : "text-ok")}>
                    {money(margin)} <span className="text-[11px] font-normal text-fg-subtle">({marginPct}%)</span>
                  </dd>
                </div>
                <Row label="Rate per km" hint={`${number(load.distanceKm)} loaded + ${number(load.emptyKm)} empty km`}>
                  <span className="num text-fg">{fmtRpk(rpk)}</span>
                </Row>
              </dl>

              <div className="mt-4 border-t border-line pt-3">
                {load.invoice ? (
                  <>
                    <Link href={`/finance/invoices/${load.invoice.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2 hover:bg-sunken">
                      <span className="flex items-center gap-2 text-[13px] font-medium text-fg"><FileText className="h-4 w-4 text-fg-subtle" /><span className="num">{load.invoice.number}</span></span>
                      <span className="flex items-center gap-2"><span className="num text-[12px] text-fg-muted">{money(load.invoice.amount)}</span><Badge value={load.invoice.status} /></span>
                    </Link>
                    <p className="mt-1.5 text-[11px] text-fg-subtle">
                      {load.invoice.status === "PAID" ? `Paid ${date(load.invoice.paidAt)}` : `Due ${date(load.invoice.dueAt)}`} · billed to {billTo.name}
                    </p>
                  </>
                ) : transitions.includes("INVOICED") && canFinance && (status === "DELIVERED" || status === "TONU") ? (
                  <form action={invoiceLoad.bind(null, id)}>
                    <button type="submit" className={cn(buttonClass(missing.length ? "secondary" : "primary"), "w-full")}>
                      {status === "TONU" ? `Invoice TONU fee${missing.length ? " anyway" : ""}` : missing.length ? "Generate invoice anyway" : "Generate invoice"}
                    </button>
                    <p className={cn("mt-1.5 text-[11px]", missing.length ? "text-warn" : "text-fg-subtle")}>
                      {missing.length
                        ? `${missing.map((k) => DOC_KIND_LABELS[k] ?? k).join(" and ")} not on file yet.`
                        : `Creates a draft invoice to ${billTo.name}, due in ${billTo.paymentTerms} days.`}
                    </p>
                  </form>
                ) : transitions.includes("INVOICED") && editable ? (
                  <ActionForm action={setLoadStatus.bind(null, id)}>
                    <input type="hidden" name="status" value="INVOICED" />
                    <SubmitButton variant="secondary" className="w-full" pendingText="Sending…">{status === "TONU" ? "Invoice TONU fee" : "Send to billing"}</SubmitButton>
                    <p className="mt-1.5 text-[11px] text-fg-subtle">Creates a draft invoice to {billTo.name} for accounting to review.</p>
                  </ActionForm>
                ) : (
                  <p className="text-[12px] text-fg-muted">
                    {status === "CANCELLED" ? "Cancelled loads are not invoiced."
                      : status === "DELIVERED" || status === "TONU" ? "Waiting for dispatch or accounting to raise the invoice."
                      : "Invoicing opens after delivery."}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card title="Customer & broker">
            <Party label="Customer" c={load.customer} />
            {load.broker && <Party label="Broker" c={load.broker} className="mt-3 border-t border-line pt-3" />}
            <p className="mt-3 text-[11px] text-fg-subtle">Invoices go to {billTo.name} · {billTo.paymentTerms}-day terms</p>
          </Card>

          {load.claims.length > 0 && (
            <Card title="Claims" flush actions={<span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{load.claims.length}</span>}>
              <ul className="divide-y divide-line">
                {load.claims.map((c) => (
                  <li key={c.id}>
                    <Link href={`/claims/${c.id}`} className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-raised">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-fg-subtle" />
                      <span className="num font-medium text-fg">{c.number}</span>
                      <span className="flex-1 truncate text-fg-muted">{CLAIM_TYPE_LABELS[c.type] ?? humanize(c.type)}</span>
                      <Badge value={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {can(user.role, "users.manage") && (status === "PLANNED" || status === "CANCELLED") && (
            <div className="pt-1"><DeleteLoadButton loadId={id} reference={load.reference} /></div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-subtle">
        {label}
        {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
      </dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function Party({ label, c, className }: {
  label: string; className?: string;
  c: { id: string; name: string; kind: string; contactName: string | null; phone: string | null; email: string | null; city: string | null };
}) {
  return (
    <div className={className}>
      <p className="eyebrow mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <Link href={`/customers/${c.id}`} className="truncate text-[13px] font-medium text-fg hover:underline">{c.name}</Link>
        <Chip className="normal-case tracking-normal">{CUSTOMER_KIND_LABELS[c.kind] ?? c.kind}</Chip>
      </div>
      <p className="mt-0.5 text-[12px] text-fg-muted">{c.contactName ?? "No contact on file"}{c.city && ` · ${c.city}`}</p>
      {(c.phone || c.email) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          {c.phone && <a href={`tel:${c.phone}`} className="num inline-flex items-center gap-1 text-fg-muted hover:text-fg"><Phone className="h-3 w-3" />{c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 truncate text-fg-muted hover:text-fg"><Mail className="h-3 w-3" />{c.email}</a>}
        </p>
      )}
    </div>
  );
}
