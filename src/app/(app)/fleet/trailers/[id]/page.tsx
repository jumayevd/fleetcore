import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Pencil, Phone } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EQUIPMENT_LABELS, LOAD_STATUS_LABELS, TRAILER_STATUS_LABELS, WORK_ORDER_CATEGORY_LABELS, type LoadStatus } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS, DOC_KIND_LABELS } from "@/lib/documents";
import { kg, km, money, date, dateTime, ago, daysUntil } from "@/lib/format";
import { syncSimulatedPositions } from "@/lib/telemetry";
import { Badge, Card, DL, Disclosure, EmptyState, ExpiryBadge, LinkButton, PageHeader, Stat, Table, cardClass, cn } from "@/components/ui";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { WorkOrderActions } from "../../work-order-actions";
import { docExpiryByUnit, missingDocs, paperworkExpiry, pingStale, sinceShort } from "../../lib";
import { TrailerStatusControl } from "../status-control";

export async function generateMetadata({ params }: PageProps<"/fleet/trailers/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.trailer.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: r?.unitNumber ?? "Not found" };
}

export default async function TrailerDetail({ params }: PageProps<"/fleet/trailers/[id]">) {
  const user = await requireUser("fleet.view");
  const { id } = await params;
  const editable = can(user.role, "fleet.edit");
  const showRevenue = can(user.role, "finance.view") || can(user.role, "loads.edit") || can(user.role, "reports.view");

  await syncSimulatedPositions();
  const trailer = await db.trailer.findUnique({
    where: { id },
    include: {
      truck: { select: { id: true, unitNumber: true, make: true, model: true, status: true, driver: { select: { id: true, name: true, phone: true } } } },
      workOrders: { orderBy: [{ status: "asc" }, { scheduledAt: "desc" }], take: 30 },
      loads: { orderBy: { pickupAt: "desc" }, take: 15, include: { customer: { select: { name: true } }, truck: { select: { id: true, unitNumber: true } } } },
    },
  });
  if (!trailer) notFound();
  const docRows = await db.document.findMany({
    where: { trailerId: id, kind: { in: [...REQUIRED_UNIT_DOCS] } }, orderBy: { createdAt: "desc" }, select: { kind: true, expiresAt: true },
  });
  const missing = missingDocs(new Set(docRows.map((d) => d.kind)), REQUIRED_UNIT_DOCS);
  // Same rule as the trailer list: the earlier of the record date and the newest uploaded document's expiry.
  const paper = paperworkExpiry(trailer, docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id));
  const activeLoad = trailer.loads.find((l) => l.status === "ASSIGNED" || l.status === "IN_TRANSIT") ?? null;
  const openWo = trailer.workOrders.filter((w) => ["OPEN", "IN_PROGRESS", "DRAFT"].includes(w.status));
  const sortedWo = [...openWo.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()), ...trailer.workOrders.filter((w) => !openWo.includes(w))];
  const inShopDays = (w: { inAt: Date | null; outAt: Date | null }) => w.inAt ? Math.max(0, Math.round(((w.outAt ?? new Date()).getTime() - w.inAt.getTime()) / 86_400_000)) : null;
  const typeLabel = EQUIPMENT_LABELS[trailer.type] ?? trailer.type;

  return (
    <>
      <PageHeader
        eyebrow={`${typeLabel}${trailer.year ? ` · ${trailer.year}` : ""}`}
        title={<span className="num">{trailer.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrailerStatusControl id={id} status={trailer.status} locationName={trailer.locationName} editable={editable} since={`${sinceShort(trailer.statusSince)} · since ${date(trailer.statusSince)}`} />
            {trailer.plate && <span>Plate <span className="num text-fg">{trailer.plate}</span></span>}
          </span>
        }
        actions={editable && <LinkButton href={`/fleet/trailers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paired truck" value={trailer.truck ? trailer.truck.unitNumber : "—"} hint={trailer.truck ? `${trailer.truck.make} ${trailer.truck.model}${trailer.truck.driver ? ` · ${trailer.truck.driver.name}` : ""}` : "not paired with a tractor"} tone={trailer.truck ? "info" : "neutral"} />
        <Stat label="Current load" value={activeLoad ? activeLoad.reference : "—"} hint={activeLoad ? `${activeLoad.originCity} → ${activeLoad.destCity}` : trailer.status === "EMPTY" || trailer.status === "YARD" ? "available for dispatch" : "no active load"} tone={activeLoad ? "progress" : "neutral"} />
        <Stat label="Location" value={<span className="text-[15px]">{trailer.locationName ?? "Unknown"}</span>} hint={trailer.lastPingAt ? `${ago(trailer.lastPingAt)} · ${trailer.gpsProvider ?? "GPS"}` : trailer.gpsProvider ? `${trailer.gpsProvider} · no ping yet` : "no tracker fitted"} />
        <Stat label="Paperwork" value={`${REQUIRED_UNIT_DOCS.length - missing.length}/${REQUIRED_UNIT_DOCS.length}`} hint={missing.length ? `missing ${missing.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")}` : "all required documents on file"} tone={missing.length ? "warn" : "ok"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Work orders" flush actions={<span className="text-[11px] text-fg-subtle"><span className="num">{openWo.length}</span> open</span>}>
            <Table head={["#", "Work", "Category", "Vendor", "Scheduled", "In shop", "Cost", "Status", ""]}>
              {sortedWo.map((w) => {
                const days = inShopDays(w);
                return (
                  <tr key={w.id} className={w.status === "CANCELLED" ? "opacity-60" : undefined}>
                    <td><Link href={`/maintenance/work-orders/${w.id}`} className="num font-medium hover:underline">#{w.number}</Link></td>
                    <td className="max-w-64 truncate" title={w.title}>{w.title}</td>
                    <td className="whitespace-nowrap text-fg-muted">{WORK_ORDER_CATEGORY_LABELS[w.category] ?? w.category}</td>
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
            {trailer.workOrders.length === 0 && <EmptyState title="No work orders" description="Repairs and inspections for this trailer are created from Maintenance → Work orders." />}
          </Card>

          {/* The long tail: closed until asked for, so the work orders and pairing stay on screen. */}
          <section className={cardClass}>
            <Disclosure title="Load history" icon={<History />} count={trailer.loads.length} className="[&>summary]:rounded-lg [&>summary]:py-3">
              <div className="border-t border-line">
                <Table head={["Load", "Status", "Route", "Customer", "Truck", "Pickup", "Delivered", "Distance", ...(showRevenue ? ["Rate"] : [])]}>
                  {trailer.loads.map((l) => (
                    <tr key={l.id}>
                      <td><Link href={`/loads/${l.id}`} className="num font-medium hover:underline">{l.reference}</Link></td>
                      <td><Badge value={l.status} label={LOAD_STATUS_LABELS[l.status as LoadStatus]} /></td>
                      <td className="whitespace-nowrap">{l.originCity} → {l.destCity}</td>
                      <td className="max-w-40 truncate text-fg-muted">{l.customer.name}</td>
                      <td>{l.truck ? <Link href={`/fleet/${l.truck.id}`} className="num hover:underline">{l.truck.unitNumber}</Link> : <span className="text-fg-faint">—</span>}</td>
                      <td className="whitespace-nowrap text-fg-muted">{dateTime(l.pickupAt)}</td>
                      <td className={cn("whitespace-nowrap", l.deliveredAt && l.deliveredAt > l.deliveryAt ? "text-danger" : "text-fg-muted")}>{l.deliveredAt ? dateTime(l.deliveredAt) : "—"}</td>
                      <td className="num whitespace-nowrap">{km(l.distanceKm)}</td>
                      {showRevenue && <td className="num">{money(l.rate)}</td>}
                    </tr>
                  ))}
                </Table>
                {trailer.loads.length === 0 && <EmptyState title="No loads yet" description="Pick this trailer on a load and its history will build up here." />}
              </div>
            </Disclosure>
          </section>
        </div>

        <div className="space-y-4">
          <Card title="Where it is" flush>
            {trailer.lat != null && trailer.lng != null ? (
              <div className="p-2">
                <LeafletMap height={180} fitKey={id} trucks={[{ id: trailer.id, unitNumber: trailer.unitNumber, lat: trailer.lat, lng: trailer.lng, heading: 0, speedKmh: 0, status: trailer.status === "SHOP" || trailer.status === "OUT_OF_SERVICE" ? "MAINTENANCE" : "ACTIVE", moving: false, stale: pingStale(trailer.lastPingAt), label: trailer.locationName ?? typeLabel }]} />
              </div>
            ) : <p className="px-4 py-5 text-center text-[12px] text-fg-muted">No position yet. Pair it with a tracked tractor or fit a GPS unit.</p>}
            <DL items={[
              ["Location", trailer.locationName ?? "Unknown"],
              ["Last ping", trailer.lastPingAt ? ago(trailer.lastPingAt) : "never"],
              ["GPS provider", trailer.gpsProvider ?? "None"],
              ["Status since", `${date(trailer.statusSince)} · ${sinceShort(trailer.statusSince)}`],
            ]} />
          </Card>

          <Card title="Pairing">
            <div className="space-y-3">
              <div>
                <p className="eyebrow mb-1">Tractor</p>
                {trailer.truck ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/fleet/${trailer.truck.id}`} className="num text-[13px] font-semibold text-fg hover:underline">{trailer.truck.unitNumber}</Link>
                      <p className="truncate text-[11px] text-fg-subtle">{trailer.truck.make} {trailer.truck.model}</p>
                    </div>
                    <Badge value={trailer.truck.status} />
                  </div>
                ) : <p className="text-[13px] text-fg-muted">Not paired{editable && <> · <Link href={`/fleet/trailers/${id}/edit`} className="text-fg hover:underline">pair a truck</Link></>}</p>}
              </div>
              <div>
                <p className="eyebrow mb-1">Driver</p>
                {trailer.truck?.driver ? (
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/drivers/${trailer.truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{trailer.truck.driver.name}</Link>
                    {trailer.truck.driver.phone && <a href={`tel:${trailer.truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                  </div>
                ) : <p className="text-[13px] text-fg-muted">—</p>}
              </div>
              {activeLoad && (
                <div>
                  <p className="eyebrow mb-1">Current load</p>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/loads/${activeLoad.id}`} className="num text-[13px] font-semibold text-fg hover:underline">{activeLoad.reference}</Link>
                      <p className="truncate text-[11px] text-fg-subtle">{activeLoad.originCity} → {activeLoad.destCity} · {activeLoad.customer.name}</p>
                    </div>
                    <Badge value={activeLoad.status} label={LOAD_STATUS_LABELS[activeLoad.status as LoadStatus]} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title="Unit">
            <DL items={[
              ["Type", typeLabel],
              ["Capacity", <span key="c" className="num">{kg(trailer.capacityKg)}</span>],
              ["Plate", trailer.plate ? <span key="p" className="num">{trailer.plate}</span> : "—"],
              ["Year", trailer.year ? <span key="y" className="num">{trailer.year}</span> : "—"],
              ["Insurance", <ExpiryBadge key="i" days={daysUntil(paper.INSURANCE)} />],
              ["Inspection", <ExpiryBadge key="n" days={daysUntil(paper.INSPECTION)} />],
              ["Registration", <ExpiryBadge key="r" days={daysUntil(paper.REGISTRATION)} />],
              ["Added", date(trailer.createdAt)],
              ["Status", TRAILER_STATUS_LABELS[trailer.status] ?? trailer.status],
            ]} />
            {trailer.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-[12px] leading-5 text-fg-muted">{trailer.notes}</p>}
          </Card>

          <div id="documents" className="scroll-mt-20">
            <DocumentsPanel user={user} target={{ type: "trailer", id }} path={`/fleet/trailers/${id}`} withExpiry required={[...REQUIRED_UNIT_DOCS]} />
          </div>
        </div>
      </div>
    </>
  );
}
