import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Plus, Truck as TruckIcon, Container, FileCheck, CalendarClock, MapPinned, Unlink, Wrench, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EQUIPMENT, EQUIPMENT_LABELS, REPAIR_STAGE_LABELS, TRAILER_STATUSES, TRAILER_STATUS_LABELS } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { ago, daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Badge, Card, Cell, Chip, EmptyState, ExpiryBadge, FilterPills, InfoTip, LinkButton, PageHeader, Segmented, Stat, Table, cn } from "@/components/ui";
import { ListFilters } from "../filters";
import { LinkRow } from "../link-row";
import { ColumnChooser, type ColumnDef } from "../column-chooser";
import { openDefects, openRepairs, unitDocRows } from "../data";
import { daysSince, docExpiryByUnit, docsByUnit, EXPIRY_SOON_DAYS, expiryCounts, LIST_LIMIT, missingDocs, paperworkExpiry, pingStale, sinceShort } from "../lib";
import { TrailerStatusControl } from "./status-control";
import { TrailerRowMenu } from "./row-menu";

export const metadata = { title: "Trailers" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const PAIRED_FILTERS = { no: "Not paired", yes: "Paired" } as const;

const COLUMNS: ColumnDef[] = [
  { key: "status", label: "Status" },
  { key: "truck", label: "Paired truck" },
  { key: "driver", label: "Driver" },
  { key: "location", label: "Location" },
  { key: "gps", label: "GPS", hidden: true },
  { key: "capacity", label: "Capacity", hidden: true },
  { key: "repair", label: "Repair" },
  { key: "defects", label: "Defects" },
  { key: "inspection", label: "Annual inspection" },
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration", hidden: true },
  { key: "documents", label: "Documents" },
];
const TABLE_ID = "trailer-table";

export default async function TrailersPage({ searchParams }: PageProps<"/fleet/trailers">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;
  // Other modules link a trailer as /fleet/trailers?unit=<id>[&tab=compliance]; send those to the detail page.
  const unit = str(sp.unit);
  if (unit) redirect(`/fleet/trailers/${unit}${str(sp.tab) === "compliance" ? "#documents" : ""}`);
  const status = TRAILER_STATUSES.includes(str(sp.status) as never) ? str(sp.status) : undefined;
  const type = EQUIPMENT.includes(str(sp.type) as never) ? str(sp.type) : undefined;
  const q = str(sp.q);
  const docsParam = str(sp.docs);
  const docsFilter = docsParam === "incomplete" || docsParam === "expiring" ? docsParam : undefined;
  const paired = str(sp.paired) === "no" || str(sp.paired) === "yes" ? str(sp.paired) : undefined;
  const params = { status, type, q, docs: docsFilter, paired };

  const like = { contains: q ?? "", mode: "insensitive" as const };
  const where: Prisma.TrailerWhereInput = {
    AND: [
      status ? { status } : {},
      type ? { type } : {},
      paired === "no" ? { truckId: null } : paired === "yes" ? { truckId: { not: null } } : {},
      q ? { OR: [{ unitNumber: like }, { plate: like }, { locationName: like }, { gpsProvider: like }, { truck: { unitNumber: like } }, { truck: { driver: { name: like } } }] } : {},
    ],
  };

  const [all, docRows, truckCount, defects] = await Promise.all([
    db.trailer.findMany({ select: { id: true, unitNumber: true, status: true, statusSince: true, truckId: true, insuranceExpiry: true, inspectionExpiry: true } }),
    unitDocRows("trailer"),
    db.truck.count(),
    openDefects("trailer"),
  ]);

  if (all.length === 0) {
    return (
      <>
        <PageHeader title="Trailers" actions={<FleetSwitch trucks={truckCount} trailers={0} />} />
        <Card>
          <EmptyState icon={<Container />} title={editable ? "Add your first trailer" : "No trailers yet"}
            description={editable
              ? "Each trailer gets its status, the truck it is paired with, where it was left, its paperwork slots, defects and repairs."
              : "Trailers appear here once someone with edit access adds them."}
            action={editable && <LinkButton href="/fleet/trailers/new"><Plus />Add trailer</LinkButton>} />
        </Card>
      </>
    );
  }

  const docs = docsByUnit(docRows.map((d) => ({ id: d.trailerId, kind: d.kind })));
  const docExpiry = docExpiryByUnit(docRows.map((d) => ({ id: d.trailerId, kind: d.kind, expiresAt: d.expiresAt })));
  const missingFor = (id: string) => missingDocs(docs.get(id), REQUIRED_UNIT_DOCS);
  // Expired / expiring papers per trailer, each dated by the record or the newest uploaded document, whichever is earlier.
  const expiry = all.map((t) => ({ id: t.id, ...expiryCounts(Object.values(paperworkExpiry(t, docExpiry.get(t.id)))) }));
  const expiredUnits = expiry.filter((e) => e.expired > 0).length;
  const expiringUnits = expiry.filter((e) => e.expired + e.soon > 0).length;

  // Paperwork filters depend on computed state: resolve them to ids first so the capped table below stays exact.
  const computedIds = docsFilter === "incomplete" ? all.filter((t) => missingFor(t.id).length > 0).map((t) => t.id)
    : docsFilter === "expiring" ? expiry.filter((e) => e.expired + e.soon > 0).map((e) => e.id)
    : null;
  const listWhere: Prisma.TrailerWhereInput = computedIds ? { AND: [where, { id: { in: computedIds } }] } : where;
  const rows = await db.trailer.findMany({
    where: listWhere, orderBy: { unitNumber: "asc" }, take: LIST_LIMIT + 1,
    include: { truck: { select: { id: true, unitNumber: true, make: true, model: true, driver: { select: { id: true, name: true } } } } },
  });
  const capped = rows.length > LIST_LIMIT;
  const trailers = capped ? rows.slice(0, LIST_LIMIT) : rows;
  const [matching, repairs] = await Promise.all([
    capped ? db.trailer.count({ where: listWhere }) : Promise.resolve(trailers.length),
    openRepairs("trailer", trailers.map((t) => t.id)),
  ]);

  const byStatus = (s: string) => all.filter((t) => t.status === s);
  const oldest = (s: string) => byStatus(s).sort((a, b) => a.statusSince.getTime() - b.statusSince.getTime())[0];
  const incomplete = all.filter((t) => missingFor(t.id).length > 0).length;
  const shopOldest = oldest("SHOP");
  const dropOldest = oldest("DROPPED");
  const pairedCount = all.filter((t) => t.truckId).length;
  const unpaired = all.length - pairedCount;
  const outOfService = byStatus("OUT_OF_SERVICE").length;
  const expiringHint = [
    expiredUnits ? `${expiredUnits} expired` : null,
    expiringUnits > expiredUnits ? `${expiringUnits - expiredUnits} within ${EXPIRY_SOON_DAYS} days` : null,
  ].filter(Boolean).join(" · ") || `none in the next ${EXPIRY_SOON_DAYS} days`;

  const qs = (patch: Partial<typeof params>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/fleet/trailers${s ? `?${s}` : ""}`;
  };
  // A KPI tile opens the list showing exactly the trailers it counts.
  const only = (patch: Partial<typeof params>) => qs({ status: undefined, docs: undefined, paired: undefined, ...patch });
  const filtered = Boolean(status || docsFilter || type || q || paired);
  const tile = (href: string | null, node: React.ReactNode) =>
    href ? <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link> : node;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";
  const col = (key: string, label: React.ReactNode) => <span key={key} data-col={key} className="inline-flex items-center gap-1">{label}</span>;

  return (
    <>
      <PageHeader
        title="Trailers"
        actions={
          <>
            <FleetSwitch trucks={truckCount} trailers={all.length} />
            {editable && <LinkButton href="/fleet/trailers/new"><Plus />Add trailer</LinkButton>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile(filtered ? "/fleet/trailers" : null, <Stat className={tileClass} label="Trailers" value={all.length} hint={`${pairedCount} paired · ${truckCount} trucks`} icon={<Container />} />)}
        {tile(only({ paired: "no" }), <Stat className={tileClass} label="Not paired" value={unpaired} hint="in the yard, dropped, in the shop or loose" icon={<Unlink />} />)}
        {tile(only({ status: "DROPPED" }), <Stat className={tileClass} label="Dropped" value={byStatus("DROPPED").length}
          hint={dropOldest ? `oldest ${daysSince(dropOldest.statusSince)}d · ${dropOldest.unitNumber}` : "none left at a site"} tone={dropOldest && daysSince(dropOldest.statusSince) > 14 ? "warn" : "neutral"} icon={<MapPinned />} />)}
        {tile(only({ status: "SHOP" }), <Stat className={tileClass} label="In shop" value={byStatus("SHOP").length}
          hint={[shopOldest ? `${shopOldest.unitNumber} in ${daysSince(shopOldest.statusSince)}d` : null, outOfService ? `${outOfService} out of service` : null].filter(Boolean).join(" · ") || "none in repair"}
          tone={byStatus("SHOP").length || outOfService ? "warn" : "neutral"} icon={<Wrench />} />)}
        {tile(only({ docs: "incomplete" }), <Stat className={tileClass} label="Paperwork incomplete" value={incomplete} hint="registration, insurance, annual inspection" tone={incomplete ? "warn" : "ok"} icon={<FileCheck />} />)}
        {tile(only({ docs: "expiring" }), <Stat className={tileClass} label="Paperwork expiring" value={expiringUnits} hint={expiringHint} tone={expiredUnits ? "danger" : expiringUnits ? "warn" : "ok"} icon={<CalendarClock />} />)}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills active={status ?? "all"} items={[
            { key: "all", label: "All", href: qs({ status: undefined }), count: all.length },
            ...TRAILER_STATUSES.map((s) => ({ key: s, label: TRAILER_STATUS_LABELS[s], href: qs({ status: s }), count: byStatus(s).length })),
          ]} />
          {docsFilter && <Link href={qs({ docs: undefined })} className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[12px] font-medium text-accent-text hover:opacity-80">{docsFilter === "expiring" ? "Paperwork expiring" : "Paperwork incomplete"}<X className="h-3 w-3" /></Link>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListFilters basePath="/fleet/trailers" params={params} placeholder="Unit, plate, truck, driver, place…" selects={[
            { name: "type", label: "Type", placeholder: "All types", options: EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] })) },
            { name: "paired", label: "Pairing", placeholder: "Paired or not", options: Object.entries(PAIRED_FILTERS).map(([value, label]) => ({ value, label })) },
          ]} />
          <ColumnChooser tableId={TABLE_ID} storageKey="trailers.columns" columns={COLUMNS} />
        </div>
      </div>

      <Card flush>
        <div id={TABLE_ID}>
          {capped && (
            <p className="border-b border-line bg-info-soft px-4 py-2 text-[12px] text-info">
              Showing the first <span className="num">{trailers.length}</span> of <span className="num">{matching}</span> matching trailers. Narrow the search or filters to see the rest.
            </p>
          )}
          <Table head={["Unit",
            col("status", <>Status<InfoTip>The small number next to a status is how long the trailer has been in it.</InfoTip></>),
            col("truck", "Paired truck"), col("driver", "Driver"), col("location", "Location"), col("gps", "GPS"), col("capacity", "Capacity"),
            col("repair", "Repair"), col("defects", "Defects"),
            col("inspection", "Annual inspection"), col("insurance", "Insurance"), col("registration", "Registration"), col("documents", "Documents"), ""]}>
            {trailers.map((t) => {
              const missing = missingFor(t.id);
              const onFile = REQUIRED_UNIT_DOCS.length - missing.length;
              const paper = paperworkExpiry(t, docExpiry.get(t.id));
              const r = repairs.get(t.id);
              const d = defects.get(t.id);
              return (
                <LinkRow key={t.id} href={`/fleet/trailers/${t.id}`}>
                  <td title={[t.year, t.plate].filter(Boolean).join(" · ") || undefined}>
                    <Cell mono primary={<Link href={`/fleet/trailers/${t.id}`} className="unit-no font-semibold hover:underline">{t.unitNumber}</Link>}
                      secondary={EQUIPMENT_LABELS[t.type] ?? t.type} />
                  </td>
                  <td data-col="status" className="whitespace-nowrap"><TrailerStatusControl id={t.id} status={t.status} locationName={t.locationName} editable={editable} since={sinceShort(t.statusSince)} /></td>
                  <td data-col="truck">
                    {t.truck ? (
                      <Cell mono primary={<Link href={`/fleet/${t.truck.id}`} className="unit-no font-medium hover:underline">{t.truck.unitNumber}</Link>}
                        secondary={`${t.truck.make} ${t.truck.model}`} />
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td data-col="driver">{t.truck?.driver ? <Link href={`/drivers/${t.truck.driver.id}`} className="hover:underline">{t.truck.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
                  <td data-col="location" title={t.lastPingAt ? `Last GPS position ${ago(t.lastPingAt)}` : t.gpsProvider ? "No GPS position yet" : "No tracker"}>
                    {/* The age of the position only shows when it is old or missing; the GPS column already says when there is no tracker. */}
                    <Cell primary={t.locationName ?? <span className="text-fg-faint">Unknown</span>}
                      secondary={t.lastPingAt ? (pingStale(t.lastPingAt) ? ago(t.lastPingAt) : undefined) : t.gpsProvider ? "no ping yet" : undefined} />
                  </td>
                  <td data-col="gps" className="whitespace-nowrap">{t.gpsProvider ?? <span className="text-fg-faint">None</span>}</td>
                  <td data-col="capacity" className="num whitespace-nowrap text-fg-muted">{f.weight(t.capacityKg)}</td>
                  <td data-col="repair" className="whitespace-nowrap">
                    {r ? (
                      <Link href={`/maintenance/work-orders/${r.id}`} className="group/ro block" title={r.title}>
                        <Cell mono primary={<span className="font-medium group-hover/ro:underline">{roLabel(r.number)}</span>}
                          secondary={r.status === "IN_PROGRESS" ? <span className="text-warn">{r.stage ? REPAIR_STAGE_LABELS[r.stage] ?? r.stage : "In the shop"}</span> : `Scheduled ${f.day(r.scheduledAt)}`} />
                      </Link>
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td data-col="defects" className="whitespace-nowrap">
                    {d ? (
                      <Link href={`/fleet/trailers/${t.id}#defects`} className="hover:opacity-80">
                        {d.urgent ? <Badge value="DEFECT" tone="danger" label={`${d.urgent} to fix now`} /> : <Chip tone="warn">{d.open} open</Chip>}
                      </Link>
                    ) : <span className="text-fg-faint">—</span>}
                  </td>
                  <td data-col="inspection"><ExpiryBadge days={daysUntil(paper.INSPECTION)} /></td>
                  <td data-col="insurance"><ExpiryBadge days={daysUntil(paper.INSURANCE)} /></td>
                  <td data-col="registration"><ExpiryBadge days={daysUntil(paper.REGISTRATION)} /></td>
                  <td data-col="documents">
                    <Link href={`/fleet/trailers/${t.id}#documents`} className="hover:opacity-80" title={missing.length ? `Missing ${missing.map((m) => m.toLowerCase()).join(", ")}` : "All required documents on file"}>
                      <Badge value="DOCS" tone={onFile === REQUIRED_UNIT_DOCS.length ? "ok" : onFile === 0 ? "neutral" : "warn"} label={`${onFile}/${REQUIRED_UNIT_DOCS.length}`}
                        className={cn("num", onFile === 0 && "text-fg-subtle")} />
                    </Link>
                  </td>
                  <td className="text-right"><TrailerRowMenu id={t.id} truckId={t.truckId} editable={editable} /></td>
                </LinkRow>
              );
            })}
          </Table>
          {trailers.length === 0 && (
            <EmptyState title="No trailers match" description="Try another status, type or pairing, or clear the search." action={<LinkButton href="/fleet/trailers" variant="secondary">Clear filters</LinkButton>} />
          )}
        </div>
      </Card>
    </>
  );
}

function FleetSwitch({ trucks, trailers }: { trucks: number; trailers: number }) {
  return (
    <Segmented active="trailers" items={[
      { key: "trucks", label: <span className="inline-flex items-center gap-1"><TruckIcon className="h-3.5 w-3.5" />Trucks</span>, href: "/fleet", count: trucks },
      { key: "trailers", label: <span className="inline-flex items-center gap-1"><Container className="h-3.5 w-3.5" />Trailers</span>, href: "/fleet/trailers", count: trailers },
    ]} />
  );
}
