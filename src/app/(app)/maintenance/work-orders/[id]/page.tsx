import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CheckCircle2, Clock, ExternalLink, Pencil, Store, UserRoundCheck, UserRoundX } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel, defectLabel, serviceStatus, SERVICE_STATE_LABELS, SERVICE_STATE_TONE } from "@/lib/service";
import { DEFECT_STATUS_LABELS, EQUIPMENT_LABELS, PAYER_HINTS, PAYMENT_STATUS_LABELS, REPAIR_STAGE_LABELS, VENDOR_TYPE_LABELS } from "@/lib/constants";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { Badge, Card, Chip, DL, Disclosure, Field, InfoTip, Input, LinkButton, PageHeader, Select, Table, Textarea, cn } from "@/components/ui";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { DocumentsPanel } from "@/components/documents/panel";
import { ActionButton } from "@/components/shop/action-button";
import { RepairTags } from "@/components/shop/repair-bits";
import {
  SYSTEM_FOR_TYPE, downtime, downtimeTone, driverNotTold, payerLabel, repairStatusLabel, repairStatusTone, repairTypeLabel, resetsInspection, resetsOil, stageLabel, systemLabel,
} from "@/components/shop/shared";
import { addRepairNote, closeOutRepair, deleteRepair, markDriverInformed, saveInvoice, startRepair, voidRepair } from "@/app/actions/repairs";
import { DeleteButton } from "@/components/delete-button";
import { readingsHref, trailerHref, truckHref, vendorHref, vendorsHref, workOrderHref, workOrdersHref } from "../../_lib/links";
import { StagePipeline } from "../../_components/stage-pipeline";
import { CloseOutForm } from "../../_components/close-out-form";

export async function generateMetadata({ params }: PageProps<"/maintenance/work-orders/[id]">) {
  if (!(await getCurrentUser())) return {};
  const wo = await db.workOrder.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: wo ? `${roLabel(wo.number)} ${wo.title}` : "Not found" };
}

const EVENT_LABELS: Record<string, string> = {
  STAGE: "Stage", NOTE: "Note", STATUS: "Status", DRIVER_INFORMED: "Driver told", INVOICE: "Invoice", VOID: "Void",
};
/** Money-free kinds a view-only member may open from the files list. */
const PLAIN_DOC_KINDS = ["PHOTO", "OTHER"];

export default async function RepairDetail({ params, searchParams }: PageProps<"/maintenance/work-orders/[id]">) {
  const user = await requireUser("fleet.view");
  const { id } = await params;
  const sp = await searchParams;
  const f = await getFormat();
  const wo = await db.workOrder.findUnique({
    where: { id },
    include: {
      truck: { include: { truckType: true, driver: { select: { id: true, name: true, phone: true } } } },
      trailer: { include: { truck: { select: { id: true, unitNumber: true, driver: { select: { id: true, name: true, phone: true } } } } } },
      vendorRef: true,
      chargeDriver: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { name: true } },
      lines: { orderBy: { position: "asc" } },
      events: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      defects: { select: { id: true, number: true, component: true, description: true, status: true } },
    },
  });
  if (!wo) notFound();
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const path = workOrderHref(id);
  const now = new Date();
  const nowMs = now.getTime();
  const isVoid = Boolean(wo.voidedAt) || wo.status === "CANCELLED";
  const inShop = wo.status === "IN_PROGRESS" && !isVoid;
  const scheduled = (wo.status === "OPEN" || wo.status === "DRAFT") && !isVoid;
  const done = wo.status === "DONE";
  const canWork = editable && !isVoid;
  const unitNumber = wo.truck?.unitNumber ?? wo.trailer?.unitNumber;
  const unitHref = wo.truck ? truckHref(wo.truck.id) : wo.trailer ? trailerHref(wo.trailer.id) : null;
  const driver = wo.truck?.driver ?? wo.trailer?.truck?.driver ?? null;
  const clock = downtime(wo, nowMs);
  const linesSum = wo.lines.reduce((a, l) => a + l.amount, 0);
  const notTold = driverNotTold(wo);
  const notes = wo.events.filter((e) => e.kind === "NOTE");
  const stages = wo.events.filter((e) => e.kind === "STAGE");
  const pastPromised = inShop && wo.promisedAt && wo.promisedAt.getTime() < nowMs;
  const svc = wo.truck ? serviceStatus(wo.truck, now) : null;
  const plainDocs = money ? [] : await db.document.findMany({ where: { workOrderId: id, kind: { in: PLAIN_DOC_KINDS } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, kind: true, createdAt: true } });
  const logged = typeof sp.logged === "string" ? sp.logged : null;

  const resets = resetsOil(wo)
    ? "Completing it restarts the oil interval from the odometer here."
    : resetsInspection(wo) ? "Completing it moves the annual DOT inspection a year on from the day it comes back." : null;

  return (
    <>
      <PageHeader
        title={<><span className="num text-fg-muted">{roLabel(wo.number)}</span> {wo.title}</>}
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Badge value={wo.status} tone={repairStatusTone(wo)} label={repairStatusLabel(wo)} dot />
            {inShop && wo.stage && <span className="text-fg-muted">{stageLabel(wo.stage)}</span>}
            <RepairTags w={wo} />
            {unitHref && <Link href={unitHref} className="num font-medium text-fg hover:underline">{unitNumber}</Link>}
            {(wo.vendorRef || wo.vendor) && <span>at {wo.vendorRef ? <Link href={vendorHref(wo.vendorRef.id)} className="text-fg hover:underline">{wo.vendorRef.name}</Link> : wo.vendor}</span>}
          </span>
        }
        actions={editable && (
          <>
            {canWork && scheduled && <ActionButton action={startRepair.bind(null, id)} variant="primary" size="md" pendingText="Saving…" title="The unit goes off the road and the downtime clock starts">Into the shop</ActionButton>}
            {canWork && <LinkButton href={`${path}/edit`} variant="secondary"><Pencil />Edit</LinkButton>}
            <DeleteButton action={deleteRepair.bind(null, id)} redirectTo={workOrdersHref({})}
              confirm={`Delete ${roLabel(wo.number)} for good? Its lines, history and files go with it.${inShop ? ` ${unitNumber ?? "The unit"} goes back in service.` : ""}${done ? " Service dates it already moved on the truck stay as they are." : ""} This can't be undone; Void keeps it on record instead.`} />
          </>
        )}
      />

      {logged && (
        <FormMessage tone="ok" className="mb-4">
          {logged === "oil"
            ? <>Oil change logged{wo.truck?.lastPmKm != null ? <> at <span className="num">{f.dist(wo.truck.lastPmKm)}</span>; the interval restarts from there</> : null}. {money ? "Attach the invoice file below." : ""}</>
            : <>PM service logged. The oil interval was not reset because oil &amp; filter was not ticked.</>}
        </FormMessage>
      )}
      {isVoid && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-sunken px-4 py-3 text-[13px] text-fg-muted">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Void{wo.voidedAt ? ` since ${f.dateTime(wo.voidedAt)}` : ""}{wo.voidReason ? <>: <span className="text-fg">{wo.voidReason}</span></> : null}. Kept for history; it counts in no total.</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {!isVoid && (
            <Card title={<span className="flex items-center gap-1.5">Where it is<InfoTip>{inShop ? "Tap a stage to move the repair there; add a note to say why. Each move goes on the stage history." : scheduled ? "The stages start when the unit goes into the shop." : "The stages it went through in the shop."}</InfoTip></span>}
              actions={inShop && wo.stageAt && <span className="num text-[11px] text-fg-subtle">since {f.dateTime(wo.stageAt)}</span>}>
              {scheduled ? (
                <p className="text-[13px] text-fg-muted">
                  Booked for <span className="num font-medium text-fg">{f.date(wo.scheduledAt)}</span>{wo.vendorRef || wo.vendor ? <> at {wo.vendorRef?.name ?? wo.vendor}</> : null}.
                  {" "}{wo.scheduledAt.getTime() < f.startOfDay(now).getTime() ? <span className="text-danger">The date has passed and it has not gone in.</span> : "It stays in service until it goes in."}
                </p>
              ) : (
                <StagePipeline id={id} stage={wo.stage} editable={editable && inShop} finished={done} />
              )}
              {stages.length > 0 && (
                <ol className="mt-4 space-y-1.5 border-t border-line pt-3">
                  {[...stages].reverse().map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="font-medium text-fg">{e.stage ? REPAIR_STAGE_LABELS[e.stage] ?? e.stage : "Stage"}</span>
                      {e.body && <span className="text-fg-muted">{e.body}</span>}
                      <span className="num ml-auto text-[11px] text-fg-subtle">{e.user?.name ? `${e.user.name} · ` : ""}{f.dateTime(e.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          <Card title="What was done" flush
            actions={canWork && !done && <Link href={`${path}/edit`} className="text-[12px] font-medium text-fg-muted hover:text-fg">Edit lines</Link>}>
            <Table dense head={["System", "Work performed", ...(money ? ["Amount"] : [])]} empty={wo.lines.length === 0}
              emptyTitle={done ? "No lines recorded" : "Nothing recorded yet"}
              emptyDescription={done ? "This order was completed before lines were kept." : canWork ? "Add the work as the shop reports it, or when you close the repair out." : "The work done will be listed here."}>
              {wo.lines.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-fg-muted">{systemLabel(l.system)}</td>
                  <td className="text-fg">{l.work}</td>
                  {money && <td className="num whitespace-nowrap text-right">{l.amount ? f.money2(l.amount) : <span className="text-fg-faint">—</span>}</td>}
                </tr>
              ))}
              {money && wo.lines.length > 0 && (
                <tr className="bg-sunken/60 font-medium hover:bg-sunken/60">
                  <td colSpan={2} className="text-[12px] text-fg-muted">Lines total</td>
                  <td className="num text-right">{f.money2(linesSum)}</td>
                </tr>
              )}
            </Table>
          </Card>

          <Card title="Details">
            <DL cols={3} items={[
              ["Repair type", repairTypeLabel(wo.repairType)],
              ["Technician", wo.technician ?? "—"],
              ["Unit", unitHref ? <Link key="u" href={unitHref} className="num hover:underline">{unitNumber}</Link> : "—"],
              ["Odometer in", wo.odometerKm != null ? <span key="oi" className="num">{f.dist(wo.odometerKm)}</span> : "—"],
              ["Odometer out", wo.odometerOutKm != null ? <span key="oo" className="num">{f.dist(wo.odometerOutKm)}</span> : "—"],
              ["Booked for", f.date(wo.scheduledAt)],
              ["In the shop", wo.inAt ? f.dateTime(wo.inAt) : "—"],
              ["Promised back", wo.promisedAt ? <span key="p" className={cn("num", pastPromised && "text-danger")}>{f.date(wo.promisedAt)}</span> : "—"],
              ["Back in service", wo.outAt ? f.dateTime(wo.outAt) : inShop ? "Still in" : "—"],
              ["Opened", `${f.date(wo.createdAt)}${wo.createdBy ? ` · ${wo.createdBy.name}` : ""}`],
              ["Last change", f.dateTime(wo.updatedAt)],
            ]} />
            {(wo.description || wo.notes) && (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                {wo.description && (
                  <div className="sm:col-span-2">
                    <p className="mb-1 text-[12px] text-fg-muted">Description</p>
                    <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">{wo.description}</p>
                  </div>
                )}
                {wo.notes && (
                  <div className="sm:col-span-2">
                    <p className="mb-1 text-[12px] text-fg-muted">Earlier notes</p>
                    <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">{wo.notes}</p>
                  </div>
                )}
              </div>
            )}
            {resets && !done && !isVoid && <p className="mt-4 border-t border-line pt-3 text-[12px] text-fg-subtle">{resets}</p>}
          </Card>

          <Card title="Notes" actions={notes.length > 0 && <span className="num text-[11px] text-fg-subtle">{notes.length}</span>}>
            {notes.length === 0 ? (
              <p className="text-[12px] text-fg-muted">{editable ? "No notes yet. Calls with the shop, quotes and what the driver said go here." : "No notes on this repair."}</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-[9px] bg-sunken px-3 py-2">
                    <p className="whitespace-pre-wrap text-[13px] text-fg">{n.body}</p>
                    <p className="num mt-1 text-[11px] text-fg-subtle">{n.user?.name ?? "Someone"} · {f.dateTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <ActionForm action={addRepairNote.bind(null, id)} resetOnSuccess className="mt-3 space-y-2">
                <Textarea name="body" rows={2} required maxLength={2000} placeholder="Add a note" aria-label="Note" />
                <div className="flex justify-end"><SubmitButton variant="secondary" size="sm" pendingText="Adding…">Add note</SubmitButton></div>
              </ActionForm>
            )}
          </Card>

          <Card flush>
            <Disclosure title="Activity" count={wo.events.length + 1} tone="neutral" icon={<Clock />}>
              <ol className="divide-y divide-line">
                {[...wo.events].reverse().map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[12px]">
                    <span className="w-24 shrink-0 font-medium text-fg-muted">{EVENT_LABELS[e.kind] ?? e.kind}</span>
                    <span className="min-w-0 flex-1 text-fg">
                      {e.kind === "STAGE" && e.stage ? REPAIR_STAGE_LABELS[e.stage] ?? e.stage : null}
                      {e.kind === "STAGE" && e.body ? ` · ${e.body}` : e.kind === "INVOICE" && !money ? "Invoice updated" : e.kind !== "STAGE" ? e.body : null}
                    </span>
                    <span className="num text-[11px] text-fg-subtle">{e.user?.name ? `${e.user.name} · ` : ""}{f.dateTime(e.createdAt)}</span>
                  </li>
                ))}
                <li className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[12px]">
                  <span className="w-24 shrink-0 font-medium text-fg-muted">Opened</span>
                  <span className="min-w-0 flex-1 text-fg">{roLabel(wo.number)}</span>
                  <span className="num text-[11px] text-fg-subtle">{wo.createdBy?.name ? `${wo.createdBy.name} · ` : ""}{f.dateTime(wo.createdAt)}</span>
                </li>
              </ol>
            </Disclosure>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Downtime">
            {clock ? (
              <>
                <p className={cn("num text-[26px] font-semibold leading-8 tracking-[-0.02em]", clock.running ? (downtimeTone(clock.ms) === "danger" ? "text-danger" : downtimeTone(clock.ms) === "warn" ? "text-warn" : "text-fg") : "text-fg")}>{clock.text}</p>
                <p className="text-[12px] text-fg-muted">{clock.running ? "and counting" : "off the road"}</p>
                <p className="num mt-2 text-[12px] text-fg-subtle">{f.dateTime(wo.inAt)} → {wo.outAt ? f.dateTime(wo.outAt) : "now"}</p>
                {inShop && (wo.promisedAt
                  ? <p className={cn("mt-1 text-[12px]", pastPromised ? "font-medium text-danger" : "text-fg-muted")}>{pastPromised ? `Promised for ${f.date(wo.promisedAt)}: ${Math.max(1, Math.floor((nowMs - wo.promisedAt.getTime()) / 86_400_000))}d late` : `Promised for ${f.date(wo.promisedAt)}`}</p>
                  : <p className="mt-1 text-[12px] text-fg-subtle">No date promised.{canWork ? " Add one with Edit." : ""}</p>)}
              </>
            ) : (
              <p className="text-[13px] text-fg-muted">{scheduled ? "Not in the shop yet. The clock starts when it goes in." : "No shop time recorded."}</p>
            )}
          </Card>

          {canWork && (inShop || scheduled) && (
            <Card id="close-out" className="scroll-mt-20" title={<span className="flex items-center gap-1.5">{inShop ? "Close out" : "Already done?"}<InfoTip>Completing stops the downtime clock, puts the unit back in service and resets the service of this type.</InfoTip></span>}>
              <CloseOutForm
                action={closeOutRepair.bind(null, id)}
                lines={wo.lines.map((l) => ({ system: l.system, work: l.work, amount: l.amount }))}
                money={money}
                truck={Boolean(wo.truckId)}
                odometerIn={wo.odometerKm ?? wo.truck?.odometerKm ?? null}
                now={f.dateTimeInput(now)}
                needsInAt={!wo.inAt}
                invoice={{ total: wo.invoiceTotal, number: wo.invoiceNumber, paymentStatus: wo.paymentStatus }}
                defaultSystem={SYSTEM_FOR_TYPE[wo.repairType] ?? "OTHER"}
                primary={inShop}
              />
            </Card>
          )}

          <Card title="Who pays">
            <p className="text-[13px] font-medium text-fg">{payerLabel(wo.payer)}</p>
            <p className="text-[12px] text-fg-subtle">{PAYER_HINTS[wo.payer]}</p>
            {wo.payer === "DRIVER" && (
              <div className={cn("mt-3 rounded-[9px] px-3 py-2", wo.driverInformedAt ? "bg-ok-soft" : "bg-warn-soft")}>
                <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
                  {wo.driverInformedAt ? <UserRoundCheck className="h-4 w-4 text-ok" aria-hidden /> : <UserRoundX className="h-4 w-4 text-warn" aria-hidden />}
                  {wo.chargeDriver?.name ?? "No driver picked"}
                </p>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {wo.driverInformedAt ? `Told ${f.dateTime(wo.driverInformedAt)}` : notTold ? "Not told yet. Nothing comes off their pay until they are." : "Not told."}
                  {wo.chargeDriver?.phone && <> · <a href={`tel:${wo.chargeDriver.phone}`} className="num hover:underline">{wo.chargeDriver.phone}</a></>}
                </p>
                {editable && notTold && wo.chargeDriver && <ActionButton action={markDriverInformed.bind(null, id)} className="mt-2">Driver told</ActionButton>}
              </div>
            )}
          </Card>

          {money ? (
            <>
              <Card title="Invoice" actions={wo.paymentStatus && <Badge value={wo.paymentStatus} tone={wo.paymentStatus === "PAID" ? "ok" : "warn"} label={PAYMENT_STATUS_LABELS[wo.paymentStatus]} />}>
                <DL items={[
                  ["Total", wo.invoiceTotal != null ? <span key="t" className="num">{f.money2(wo.invoiceTotal)}</span> : wo.cost ? <span key="c" className="num text-fg-muted">{f.money2(wo.cost)} recorded</span> : "—"],
                  ["Number", wo.invoiceNumber ?? "—"],
                ]} />
                {wo.invoiceTotal != null && wo.lines.length > 0 && Math.abs(wo.invoiceTotal - linesSum) >= 0.01 && (
                  <p className="mt-2 text-[11px] text-warn">Lines add up to {f.money2(linesSum)}, {f.money2(Math.abs(wo.invoiceTotal - linesSum))} {wo.invoiceTotal > linesSum ? "less" : "more"} than the invoice.</p>
                )}
                {canWork && (
                  <Disclosure title="Update the invoice" tone="neutral" className="-mx-4 mt-3 border-t border-line" bodyClassName="px-4 pb-2">
                    <ActionForm action={saveInvoice.bind(null, id)} className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Total"><Input name="invoiceTotal" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={wo.invoiceTotal ?? undefined} className="num" /></Field>
                        <Field label="Number"><Input name="invoiceNumber" defaultValue={wo.invoiceNumber ?? ""} className="num" /></Field>
                      </div>
                      <Field label="Payment">
                        <Select name="paymentStatus" defaultValue={wo.paymentStatus ?? ""} placeholder="Not set" options={Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
                      </Field>
                      <SubmitButton variant="secondary" size="sm">Save invoice</SubmitButton>
                    </ActionForm>
                  </Disclosure>
                )}
              </Card>
              <DocumentsPanel user={user} target={{ type: "workOrder", id }} path={path} title="Invoice and files" defaultKind="INVOICE"
                description="The shop's invoice, estimates and photos for this repair." />
            </>
          ) : (
            <Card title="Files">
              {plainDocs.length === 0 ? <p className="text-[12px] text-fg-muted">No photos attached.</p> : (
                <ul className="space-y-1.5">
                  {plainDocs.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-[13px]">
                      <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-fg hover:underline">{d.name}</a>
                      <span className="text-[11px] text-fg-subtle">{DOC_KIND_LABELS[d.kind] ?? d.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-fg-subtle">Invoices and costs are kept by owners, admins and fleet specialists.</p>
            </Card>
          )}

          <Card title="Shop" icon={<Store />}>
            {wo.vendorRef ? (
              <>
                <Link href={vendorHref(wo.vendorRef.id)} className="text-[13px] font-medium text-fg hover:underline">{wo.vendorRef.name}</Link>
                <p className="text-[12px] text-fg-subtle">{[VENDOR_TYPE_LABELS[wo.vendorRef.type], wo.vendorRef.city].filter(Boolean).join(" · ")}</p>
                <dl className="mt-2 space-y-1 text-[12px]">
                  {wo.vendorRef.contactName && <div className="flex gap-2"><dt className="w-16 text-fg-subtle">Contact</dt><dd className="text-fg">{wo.vendorRef.contactName}</dd></div>}
                  {wo.vendorRef.phone && <div className="flex gap-2"><dt className="w-16 text-fg-subtle">Phone</dt><dd><a href={`tel:${wo.vendorRef.phone}`} className="num text-fg hover:underline">{wo.vendorRef.phone}</a></dd></div>}
                  {wo.vendorRef.address && <div className="flex gap-2"><dt className="w-16 text-fg-subtle">Address</dt><dd className="text-fg">{wo.vendorRef.address}</dd></div>}
                </dl>
              </>
            ) : wo.vendor ? (
              <>
                <p className="text-[13px] font-medium text-fg">{wo.vendor}</p>
                <p className="mt-0.5 text-[12px] text-fg-muted">Typed on the order, not a vendor yet.{editable && <> <Link href={vendorsHref({ tidy: 1 })} className="font-medium text-fg hover:underline">Link it to a vendor</Link></>}</p>
              </>
            ) : (
              <p className="text-[12px] text-fg-muted">No shop recorded.{canWork && <> <Link href={`${path}/edit`} className="font-medium text-fg hover:underline">Pick one</Link></>}</p>
            )}
          </Card>

          {(wo.truck || wo.trailer) && (
            <Card title="Unit">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {unitHref && <Link href={unitHref} className="num text-[13px] font-medium text-fg hover:underline">{unitNumber}</Link>}
                  <p className="truncate text-[12px] text-fg-subtle">{wo.truck ? `${wo.truck.make} ${wo.truck.model} · ${wo.truck.plate}` : wo.trailer ? `${EQUIPMENT_LABELS[wo.trailer.type] ?? wo.trailer.type} trailer${wo.trailer.truck ? ` · on ${wo.trailer.truck.unitNumber}` : ""}` : ""}</p>
                </div>
                <Badge value={(wo.truck ?? wo.trailer)!.status} dot />
              </div>
              <dl className="mt-3 space-y-1.5 text-[12px]">
                {driver && <div className="flex justify-between gap-2"><dt className="text-fg-subtle">Driver</dt><dd className="text-fg">{driver.name}{driver.phone && <> · <a href={`tel:${driver.phone}`} className="num hover:underline">{driver.phone}</a></>}</dd></div>}
                {wo.truck && <div className="flex justify-between gap-2"><dt className="text-fg-subtle">Odometer</dt><dd className="num text-fg">{f.dist(wo.truck.odometerKm)}{wo.truck.odometerAt && <span className="text-fg-subtle"> · {f.day(wo.truck.odometerAt)}</span>}</dd></div>}
                {svc && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-fg-subtle">Oil change</dt>
                    <dd className="flex items-center gap-1.5">
                      {svc.left != null && svc.state !== "no_reading" && <span className={cn("num", svc.left < 0 ? "text-danger" : "text-fg")}>{svc.left < 0 ? `${f.dist(-svc.left)} over` : `${f.dist(svc.left)} left`}</span>}
                      <Badge value={svc.state} tone={SERVICE_STATE_TONE[svc.state]} label={SERVICE_STATE_LABELS[svc.state]} />
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-[12px]">
                <Link href={workOrdersHref({ unit: wo.truckId ?? wo.trailerId, status: "all" })} className="font-medium text-fg-muted hover:text-fg">All repairs on {unitNumber}</Link>
                {wo.truck && svc?.stale && editable && <Link href={readingsHref(wo.truck.id)} className="font-medium text-fg-muted hover:text-fg">Get a fresh reading <ExternalLink className="inline h-3 w-3" /></Link>}
              </div>
            </Card>
          )}

          {wo.defects.length > 0 && (
            <Card title="Defects on this repair" flush>
              <ul className="divide-y divide-line">
                {wo.defects.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-4 py-2 text-[12px]">
                    <span className="num font-medium text-fg">{defectLabel(d.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-fg-muted" title={d.description}>{d.description}</span>
                    <Chip tone={d.status === "CLOSED" ? "ok" : d.status === "REPAIRED" ? "info" : "warn"}>{DEFECT_STATUS_LABELS[d.status] ?? d.status}</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canWork && (
            <Card flush>
              <Disclosure title={done ? "Void this repair" : scheduled ? "Cancel the booking" : "Void this repair"} tone="danger" icon={<Ban />}>
                <ActionForm action={voidRepair.bind(null, id)} className="space-y-2 px-4 pb-4"
                  confirm={`Void ${roLabel(wo.number)}? It stays on record but counts in no total.${inShop ? " The unit goes back in service." : ""}`}>
                  <p className="text-[12px] text-fg-muted">
                    {inShop ? "The unit is released from the shop. " : ""}{done ? "Service dates it already moved stay as they are. " : ""}The order is kept, marked void, and leaves every count and spend.
                  </p>
                  <Textarea name="reason" rows={2} required maxLength={500} placeholder="Why (e.g. booked twice, shop cancelled)" aria-label="Reason" />
                  <SubmitButton variant="danger" size="sm" pendingText="Voiding…">Void {roLabel(wo.number)}</SubmitButton>
                </ActionForm>
              </Disclosure>
            </Card>
          )}
          {done && !isVoid && (
            <p className="flex items-center gap-1.5 px-1 text-[12px] text-fg-subtle"><CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-hidden />Completed {f.dateTime(wo.completedAt)}</p>
          )}
        </div>
      </div>
    </>
  );
}
