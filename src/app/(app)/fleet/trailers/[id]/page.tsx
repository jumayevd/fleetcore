import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Plus, Wrench } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EQUIPMENT_LABELS, TRAILER_STATUS_LABELS, WORK_ORDER_CATEGORY_LABELS } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS, DOC_KIND_LABELS } from "@/lib/documents";
import { kg, money, date, ago, daysUntil } from "@/lib/format";
import { Badge, Card, DL, EmptyState, ExpiryBadge, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { WorkOrderActions } from "../../work-order-actions";
import { docExpiryByUnit, missingDocs, paperworkExpiry, pingStale, sinceShort, TRUCK_STATUS_LABELS } from "../../lib";
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

  const trailer = await db.trailer.findUnique({
    where: { id },
    include: {
      truck: { select: { id: true, unitNumber: true, make: true, model: true, status: true, driver: { select: { id: true, name: true, phone: true } } } },
      workOrders: { orderBy: [{ status: "asc" }, { scheduledAt: "desc" }], take: 30 },
      _count: { select: { workOrders: true } },
    },
  });
  if (!trailer) notFound();
  const docRows = await db.document.findMany({
    where: { trailerId: id, kind: { in: [...REQUIRED_UNIT_DOCS] } }, orderBy: { createdAt: "desc" }, select: { kind: true, expiresAt: true },
  });
  const missing = missingDocs(new Set(docRows.map((d) => d.kind)), REQUIRED_UNIT_DOCS);
  // Same rule as the trailer list: the earlier of the record date and the newest uploaded document's expiry.
  const paper = paperworkExpiry(trailer, docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id));
  const openWo = trailer.workOrders.filter((w) => ["OPEN", "IN_PROGRESS", "DRAFT"].includes(w.status));
  const inProgress = openWo.filter((w) => w.status === "IN_PROGRESS").length;
  const sortedWo = [...openWo.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()), ...trailer.workOrders.filter((w) => !openWo.includes(w))];
  const inShopDays = (w: { inAt: Date | null; outAt: Date | null }) => w.inAt ? Math.max(0, Math.round(((w.outAt ?? new Date()).getTime() - w.inAt.getTime()) / 86_400_000)) : null;
  const typeLabel = EQUIPMENT_LABELS[trailer.type] ?? trailer.type;
  const newWorkOrder = `/maintenance/work-orders/new?trailer=${id}`;
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";

  return (
    <>
      <PageHeader
        title={<span className="num">{trailer.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrailerStatusControl id={id} status={trailer.status} locationName={trailer.locationName} editable={editable} since={`${sinceShort(trailer.statusSince)} · since ${date(trailer.statusSince)}`} />
            <span>{typeLabel}{trailer.year ? ` · ${trailer.year}` : ""}</span>
            {trailer.plate && <span>Plate <span className="num text-fg">{trailer.plate}</span></span>}
          </span>
        }
        actions={editable && (
          <>
            <LinkButton href={`/fleet/trailers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
            <LinkButton href={newWorkOrder}><Wrench />New work order</LinkButton>
          </>
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile(trailer.truck ? `/fleet/${trailer.truck.id}` : editable ? `/fleet/trailers/${id}/edit` : "#pairing",
          <Stat className={tileClass} label="Paired truck" value={trailer.truck ? trailer.truck.unitNumber : "—"}
            hint={trailer.truck ? `${trailer.truck.make} ${trailer.truck.model}${trailer.truck.driver ? ` · ${trailer.truck.driver.name}` : ""}` : "not paired with a truck"} tone={trailer.truck ? "info" : "neutral"} />)}
        {tile("#work-orders", <Stat className={tileClass} label="Open work orders" value={openWo.length}
          hint={inProgress ? `${inProgress} in the shop now` : openWo.length ? "scheduled" : "nothing open"} tone={inProgress ? "warn" : "neutral"} />)}
        {tile("#where", <Stat className={tileClass} label="Location" value={<span className="text-[15px]">{trailer.locationName ?? "Unknown"}</span>}
          hint={trailer.lastPingAt ? `${ago(trailer.lastPingAt)} · ${trailer.gpsProvider ?? "GPS"}` : trailer.gpsProvider ? `${trailer.gpsProvider} · no ping yet` : "no tracker fitted"} />)}
        {tile("#documents", <Stat className={tileClass} label="Paperwork" value={`${REQUIRED_UNIT_DOCS.length - missing.length}/${REQUIRED_UNIT_DOCS.length}`}
          hint={missing.length ? `missing ${missing.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")}` : "all required documents on file"} tone={missing.length ? "warn" : "ok"} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card id="work-orders" className="scroll-mt-20" title="Work orders" flush actions={
            <span className="text-[11px] text-fg-subtle">
              <span className="num">{openWo.length}</span> open
              {trailer._count.workOrders > trailer.workOrders.length && <> · <Link href={`/maintenance/work-orders?unit=${id}&status=all`} className="font-medium text-fg-muted hover:text-fg">All {trailer._count.workOrders} in Maintenance →</Link></>}
            </span>
          }>
            {sortedWo.length > 0 && (
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
            )}
            {sortedWo.length === 0 && (
              <EmptyState icon={<Wrench />} title="No work orders yet"
                description={editable ? "Repairs, tyre jobs and inspections for this trailer live here. Starting one moves the trailer to Shop." : "Repairs and inspections for this trailer will appear here."}
                action={editable && <LinkButton href={newWorkOrder} variant="secondary"><Plus />New work order</LinkButton>} />
            )}
          </Card>

          <div id="documents" className="scroll-mt-20">
            <DocumentsPanel user={user} target={{ type: "trailer", id }} path={`/fleet/trailers/${id}`} withExpiry required={[...REQUIRED_UNIT_DOCS]} />
          </div>
        </div>

        <div className="space-y-4">
          <Card id="where" className="scroll-mt-20" title="Where it is" flush>
            {trailer.lat != null && trailer.lng != null ? (
              <div className="p-2">
                <LeafletMap height={180} fitKey={id} trucks={[{ id: trailer.id, unitNumber: trailer.unitNumber, lat: trailer.lat, lng: trailer.lng, heading: 0, speedKmh: 0, status: trailer.status === "SHOP" || trailer.status === "OUT_OF_SERVICE" ? "MAINTENANCE" : "ACTIVE", moving: false, stale: pingStale(trailer.lastPingAt), label: trailer.locationName ?? typeLabel }]} />
              </div>
            ) : (
              <p className="px-4 py-5 text-center text-[12px] text-fg-muted">
                {trailer.locationName ? `"${trailer.locationName}" names no known city, so it is not on the map.` : "No position yet."}
                {editable && " Set Dropped or Yard with a city, or edit the location."}
              </p>
            )}
            <div className="px-4 pb-4 pt-2">
              <DL items={[
                ["Location", trailer.locationName ?? "Unknown"],
                ["Last GPS ping", trailer.lastPingAt ? ago(trailer.lastPingAt) : "never"],
                ["GPS provider", trailer.gpsProvider ?? "None"],
                ["Status since", `${date(trailer.statusSince)} · ${sinceShort(trailer.statusSince)}`],
              ]} />
            </div>
          </Card>

          <Card id="pairing" className="scroll-mt-20" title="Pairing">
            <div className="space-y-3">
              <div>
                <p className="eyebrow mb-1">Truck</p>
                {trailer.truck ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/fleet/${trailer.truck.id}`} className="num text-[13px] font-semibold text-fg hover:underline">{trailer.truck.unitNumber}</Link>
                      <p className="truncate text-[11px] text-fg-subtle">{trailer.truck.make} {trailer.truck.model}</p>
                    </div>
                    <Badge value={trailer.truck.status} label={TRUCK_STATUS_LABELS[trailer.truck.status]} />
                  </div>
                ) : <p className="text-[13px] text-fg-muted">Not paired{editable && <> · <Link href={`/fleet/trailers/${id}/edit`} className="font-medium text-fg hover:underline">Pair a truck</Link></>}</p>}
              </div>
              <div>
                <p className="eyebrow mb-1">Driver</p>
                {trailer.truck?.driver ? (
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/drivers/${trailer.truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{trailer.truck.driver.name}</Link>
                    {trailer.truck.driver.phone && <a href={`tel:${trailer.truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                  </div>
                ) : <p className="text-[13px] text-fg-muted">{trailer.truck ? "The paired truck has no driver" : "—"}</p>}
              </div>
            </div>
          </Card>

          <Card title="Unit" actions={editable && <LinkButton href={`/fleet/trailers/${id}/edit`} variant="ghost" size="sm"><Pencil />Edit</LinkButton>}>
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
        </div>
      </div>
    </>
  );
}
