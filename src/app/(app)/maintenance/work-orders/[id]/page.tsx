import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";
import { ago, date, dateTime, km, money, number } from "@/lib/format";
import { Badge, Card, Chip, DL, InfoTip, LinkButton, PageHeader, Table, cn } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents/panel";
import { activeLoadsByUnit, daysBetween, pmNextService, shopTone } from "../../_lib/data";
import { loadHref, maintenanceHref, trailerHref, truckHref, workOrderHref } from "../../_lib/links";
import { NO_VENDOR, onLoadReason } from "../../_lib/shared";
import { UnitLink } from "../../_components/unit-link";
import { WorkOrderStatusButtons } from "../../_components/work-order-status";

export async function generateMetadata({ params }: PageProps<"/maintenance/work-orders/[id]">) {
  if (!(await getCurrentUser())) return {};
  const wo = await db.workOrder.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: wo ? `#${wo.number} ${wo.title}` : "Not found" };
}

export default async function WorkOrderDetail({ params }: PageProps<"/maintenance/work-orders/[id]">) {
  const user = await requireUser("fleet.view");
  const { id } = await params;
  const wo = await db.workOrder.findUnique({
    where: { id },
    include: { truck: true, trailer: true, createdBy: { select: { name: true } } },
  });
  if (!wo) notFound();
  const editable = can(user.role, "fleet.edit");
  const path = workOrderHref(id);
  const unitId = wo.truckId ?? wo.trailerId;
  const unitWhere = wo.truckId ? { truckId: wo.truckId } : wo.trailerId ? { trailerId: wo.trailerId } : null;
  const [related, loads] = await Promise.all([
    unitWhere
      ? db.workOrder.findMany({ where: { ...unitWhere, id: { not: id } }, orderBy: { scheduledAt: "desc" }, take: 6, select: { id: true, number: true, title: true, status: true, category: true, cost: true, scheduledAt: true, completedAt: true } })
      : [],
    unitId ? activeLoadsByUnit([unitId]) : null,
  ]);
  const load = unitId ? loads?.get(unitId) : undefined;
  const unitNumber = wo.truck?.unitNumber ?? wo.trailer?.unitNumber;
  // Not started yet and the unit is out on a load: Start stays disabled until the load is recovered.
  const startBlocked = load && unitNumber && (wo.status === "DRAFT" || wo.status === "OPEN") ? onLoadReason(unitNumber, load.reference) : null;

  const now = new Date();
  const shopDays = wo.inAt ? daysBetween(wo.inAt, wo.outAt ?? undefined) : null;
  const inShop = wo.status === "IN_PROGRESS";
  const labourShare = wo.cost > 0 ? Math.min(100, Math.round((wo.laborCost / wo.cost) * 100)) : 0;
  const partsShare = wo.cost > 0 ? Math.min(100 - labourShare, Math.round((wo.partsCost / wo.cost) * 100)) : 0;
  const unitHref = wo.truck ? truckHref(wo.truck.id) : wo.trailer ? trailerHref(wo.trailer.id) : null;
  const unitLabel = wo.truck ? `${wo.truck.unitNumber} · ${wo.truck.make} ${wo.truck.model}` : wo.trailer ? `${wo.trailer.unitNumber} · ${humanize(wo.trailer.type)} trailer` : "No unit";
  // Same PM rule as the PM board and alerts: explicit next service, else last PM + interval.
  const nextService = wo.truck ? pmNextService(wo.truck) : null;
  const kmToService = wo.truck && nextService != null ? nextService - wo.truck.odometerKm : null;
  const unitFacts: [string, ReactNode][] = [];
  if (wo.truck) {
    unitFacts.push(
      ["Odometer", km(wo.truck.odometerKm)],
      ["Next service", kmToService == null ? "—"
        : kmToService < 0 ? <span key="n" className="num text-danger">{number(-kmToService)} km overdue</span>
        : <span key="n" className={cn("num", kmToService <= 2000 && "text-warn")}>in {number(kmToService)} km</span>],
    );
  }
  if (load) unitFacts.push(["On load", <Link key="l" href={loadHref(load.id)} className="num hover:underline">{load.reference}</Link>]);

  // `done` defaults to "has a date"; the scheduled date exists from the start, so it only counts once it has passed.
  const steps: { label: string; at: Date | null; hint?: string; done?: boolean; dateOnly?: boolean }[] = [
    { label: "Created", at: wo.createdAt, hint: wo.createdBy?.name ? `by ${wo.createdBy.name}` : undefined },
    { label: "Scheduled", at: wo.scheduledAt, done: wo.scheduledAt <= now || Boolean(wo.inAt), dateOnly: true },
    { label: "Into the shop", at: wo.inAt, hint: wo.vendor ?? undefined },
    { label: "Out of the shop", at: wo.outAt, hint: shopDays != null ? `${shopDays}d in shop` : undefined },
    { label: wo.status === "CANCELLED" ? "Cancelled" : "Completed", at: wo.status === "CANCELLED" ? wo.updatedAt : wo.completedAt },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/maintenance/work-orders" className="hover:text-fg">Work orders</Link>}
        title={<><span className="num text-fg-muted">#{wo.number}</span> {wo.title}</>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={wo.status} dot />
            {wo.priority !== "LOW" && wo.priority !== "MEDIUM" && <Badge value={wo.priority} />}
            <Chip>{WORK_ORDER_CATEGORY_LABELS[wo.category] ?? humanize(wo.category)}</Chip>
            {unitHref ? <Link href={unitHref} className="font-medium text-fg hover:underline">{unitLabel}</Link> : <span>{unitLabel}</span>}
            {inShop && shopDays != null && <Badge value="SHOP" tone={shopTone(shopDays)} label={`${shopDays}d in shop`} className="num" />}
          </span>
        }
        actions={editable && (
          <>
            <WorkOrderStatusButtons id={wo.id} status={wo.status} number={wo.number} size="md" blockedBy={startBlocked} />
            <LinkButton href={`${path}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
          </>
        )}
      />

      {startBlocked && load && (
        <p role="note" className="mb-4 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] leading-4 text-warn">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="num font-medium">{unitNumber}</span> is on load{" "}
            <Link href={loadHref(load.id)} className="num font-medium underline underline-offset-2">{load.reference}</Link> ({humanize(load.status).toLowerCase()}).
            {" "}Recover the load to another unit before starting this job.
          </span>
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Details">
            <DL cols={3} items={[
              ["Unit", unitHref ? <Link key="u" href={unitHref} className="hover:underline">{wo.truck?.unitNumber ?? wo.trailer?.unitNumber}</Link> : "—"],
              ["Category", WORK_ORDER_CATEGORY_LABELS[wo.category] ?? humanize(wo.category)],
              ["Priority", humanize(wo.priority)],
              ["Vendor / shop", wo.vendor ?? <span key="v" className="font-normal text-fg-subtle">{NO_VENDOR}</span>],
              ["Scheduled for", date(wo.scheduledAt)],
              ["Odometer at service", wo.odometerKm != null ? km(wo.odometerKm) : wo.truck ? `${km(wo.truck.odometerKm)} (truck, current)` : "—"],
              ["Into the shop", wo.inAt ? dateTime(wo.inAt) : "—"],
              ["Out of the shop", wo.outAt ? dateTime(wo.outAt) : inShop ? "still in" : "—"],
              ["Completed", wo.completedAt ? dateTime(wo.completedAt) : "—"],
              ["Created by", wo.createdBy?.name ?? "—"],
              ["Created", `${date(wo.createdAt)} · ${ago(wo.createdAt)}`],
              ["Last updated", ago(wo.updatedAt)],
            ]} />
            {(wo.description || wo.notes) && (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <div>
                  <p className="eyebrow mb-1">Description</p>
                  <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">{wo.description ?? <span className="text-fg-faint">—</span>}</p>
                </div>
                <div>
                  <p className="eyebrow mb-1">Internal notes</p>
                  <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">{wo.notes ?? <span className="text-fg-faint">—</span>}</p>
                </div>
              </div>
            )}
          </Card>

          <Card title={`Other work on ${wo.truck?.unitNumber ?? wo.trailer?.unitNumber ?? "this unit"}`} flush
            actions={unitWhere && <Link href={maintenanceHref({ tab: "log", unit: wo.truckId ?? wo.trailerId, period: "year" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Repair log</Link>}>
            <Table dense head={["#", "Work", "Category", "Status", "Date", "Cost"]} empty={related.length === 0} emptyTitle="No other work orders" emptyDescription="This is the first work order recorded for the unit.">
              {related.map((r) => (
                <tr key={r.id}>
                  <td><Link href={workOrderHref(r.id)} className="num font-medium text-fg hover:underline">#{r.number}</Link></td>
                  <td className="max-w-72 truncate"><Link href={workOrderHref(r.id)} className="hover:underline">{r.title}</Link></td>
                  <td className="whitespace-nowrap text-fg-muted">{WORK_ORDER_CATEGORY_LABELS[r.category] ?? humanize(r.category)}</td>
                  <td><Badge value={r.status} /></td>
                  <td className="whitespace-nowrap text-fg-muted">{date(r.completedAt ?? r.scheduledAt)}</td>
                  <td className="num">{r.cost ? money(r.cost) : <span className="text-fg-faint">—</span>}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Costs">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Total</p>
                <p className="num mt-1 text-[22px] font-semibold leading-none text-fg">{money(wo.cost)}</p>
              </div>
              {wo.cost > 0 && wo.cost !== wo.laborCost + wo.partsCost && (
                <span className="text-[11px] text-fg-subtle">labour + parts = {money(wo.laborCost + wo.partsCost)}</span>
              )}
            </div>
            {wo.cost > 0 && (
              <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
                <span className="h-full bg-info" style={{ width: `${labourShare}%` }} />
                <span className="h-full bg-warn" style={{ width: `${partsShare}%` }} />
              </div>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div><dt className="flex items-center gap-1.5 text-[11px] text-fg-subtle"><span className="h-2 w-2 rounded-sm bg-info" />Labour</dt><dd className="num mt-0.5 text-[13px] font-medium">{money(wo.laborCost)}</dd></div>
              <div><dt className="flex items-center gap-1.5 text-[11px] text-fg-subtle"><span className="h-2 w-2 rounded-sm bg-warn" />Parts</dt><dd className="num mt-0.5 text-[13px] font-medium">{money(wo.partsCost)}</dd></div>
            </dl>
            {wo.cost === 0 && <p className="mt-3 text-[12px] text-fg-muted">No costs recorded yet. {editable ? "Add labour and parts from Edit once the vendor invoice arrives." : ""}</p>}
          </Card>

          <Card title={wo.truck && wo.category === "PM" && wo.status !== "DONE" && wo.status !== "CANCELLED"
            ? <span className="flex items-center gap-1.5">Timeline<InfoTip>Completing this PM sets the truck&apos;s next service to the odometer here plus its {number(wo.truck.pmIntervalKm)} km interval.</InfoTip></span>
            : "Timeline"}>
            <ol className="space-y-3">
              {steps.map((s, i) => {
                const done = s.done ?? Boolean(s.at);
                const cancelled = wo.status === "CANCELLED" && i === steps.length - 1;
                return (
                  <li key={s.label} className="flex items-start gap-3">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", cancelled ? "bg-danger" : done ? "bg-ok" : "border border-line-strong bg-surface")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("text-[13px]", done ? "font-medium text-fg" : "text-fg-subtle")}>{s.label}</span>
                        <span className="num shrink-0 text-[11px] text-fg-subtle">{s.at ? (s.dateOnly ? date(s.at) : dateTime(s.at)) : "—"}</span>
                      </div>
                      {s.hint && <p className="text-[11px] text-fg-subtle">{s.hint}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <DocumentsPanel user={user} target={{ type: "workOrder", id }} path={path} description="Estimates, vendor invoices and photos for this job." />

          {(wo.truck || wo.trailer) && (
            <Card title="Unit">
              <div className="flex items-center justify-between gap-3">
                <UnitLink truck={wo.truck} trailer={wo.trailer} secondary={wo.truck ? `${wo.truck.make} ${wo.truck.model} · ${wo.truck.plate}` : wo.trailer ? `${humanize(wo.trailer.type)} · ${wo.trailer.plate ?? "no plate"}` : undefined} />
                <Badge value={(wo.truck ?? wo.trailer)!.status} dot />
              </div>
              {unitFacts.length > 0 && <div className="mt-3"><DL items={unitFacts} /></div>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
