import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Plus, Truck as TruckIcon, Container, FileCheck, CalendarClock, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EQUIPMENT, EQUIPMENT_LABELS, TRAILER_STATUSES, TRAILER_STATUS_LABELS } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { kg, ago, daysUntil } from "@/lib/format";
import { syncSimulatedPositions } from "@/lib/telemetry";
import { Badge, Card, Cell, EmptyState, ExpiryBadge, FilterPills, InfoTip, LinkButton, PageHeader, Segmented, STATUS_TONE, Stat, Table, cn } from "@/components/ui";
import { ListFilters } from "../filters";
import { LinkRow } from "../link-row";
import { daysSince, docExpiryByUnit, docsByUnit, EXPIRY_SOON_DAYS, expiryCounts, LIST_LIMIT, missingDocs, paperworkExpiry, pingStale, sinceShort } from "../lib";
import { TrailerStatusControl } from "./status-control";
import { TrailerRowMenu } from "./row-menu";

export const metadata = { title: "Trailers" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export default async function TrailersPage({ searchParams }: PageProps<"/fleet/trailers">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const sp = await searchParams;
  // Other modules link a trailer as /fleet/trailers?unit=<id>[&tab=compliance]; send those to the detail page.
  const unit = str(sp.unit);
  if (unit) redirect(`/fleet/trailers/${unit}${str(sp.tab) === "compliance" ? "#documents" : ""}`);
  const status = TRAILER_STATUSES.includes(str(sp.status) as never) ? str(sp.status) : undefined;
  const type = EQUIPMENT.includes(str(sp.type) as never) ? str(sp.type) : undefined;
  const q = str(sp.q);
  const docsParam = str(sp.docs);
  const docsFilter = docsParam === "incomplete" || docsParam === "expiring" ? docsParam : undefined;
  const params = { status, type, q, docs: docsFilter };

  await syncSimulatedPositions();

  const like = { contains: q ?? "", mode: "insensitive" as const };
  const where: Prisma.TrailerWhereInput = {
    AND: [
      status ? { status } : {},
      type ? { type } : {},
      q ? { OR: [{ unitNumber: like }, { plate: like }, { locationName: like }, { gpsProvider: like }, { truck: { unitNumber: like } }, { truck: { driver: { name: like } } }] } : {},
    ],
  };

  const [all, docRows, truckCount] = await Promise.all([
    db.trailer.findMany({ select: { id: true, unitNumber: true, status: true, statusSince: true, truckId: true, insuranceExpiry: true, inspectionExpiry: true } }),
    db.document.findMany({
      where: { trailerId: { not: null }, kind: { in: [...REQUIRED_UNIT_DOCS] } }, orderBy: { createdAt: "desc" }, select: { trailerId: true, kind: true, expiresAt: true },
    }),
    db.truck.count(),
  ]);

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
    include: {
      truck: { select: { id: true, unitNumber: true, driver: { select: { id: true, name: true } } } },
      loads: { where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] } }, orderBy: { pickupAt: "asc" }, take: 1, select: { id: true, reference: true } },
    },
  });
  const capped = rows.length > LIST_LIMIT;
  const trailers = capped ? rows.slice(0, LIST_LIMIT) : rows;
  const matching = capped ? await db.trailer.count({ where: listWhere }) : trailers.length;

  const byStatus = (s: string) => all.filter((t) => t.status === s);
  const oldest = (s: string) => byStatus(s).sort((a, b) => a.statusSince.getTime() - b.statusSince.getTime())[0];
  const incomplete = all.filter((t) => missingFor(t.id).length > 0).length;
  const shopOldest = oldest("SHOP");
  const dropOldest = oldest("DROPPED");
  const paired = all.filter((t) => t.truckId).length;
  // The load workflow leaves a delivered trailer Empty and still on its tractor; only hand-set ones may be loose.
  const emptyLoose = byStatus("EMPTY").filter((t) => !t.truckId).length;
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
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";
  const statusTile = (s: string, hint?: string) => tile(qs({ status: s, docs: undefined }),
    <Stat className={tileClass} label={TRAILER_STATUS_LABELS[s]} value={byStatus(s).length} hint={hint} tone={byStatus(s).length ? STATUS_TONE[s] : "neutral"} />);

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Trailers"
        actions={
          <>
            <Segmented active="trailers" items={[
              { key: "trucks", label: <span className="inline-flex items-center gap-1"><TruckIcon className="h-3.5 w-3.5" />Trucks</span>, href: "/fleet", count: truckCount },
              { key: "trailers", label: <span className="inline-flex items-center gap-1"><Container className="h-3.5 w-3.5" />Trailers</span>, href: "/fleet/trailers", count: all.length },
            ]} />
            {editable && <LinkButton href="/fleet/trailers/new"><Plus />Add trailer</LinkButton>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        {tile(status || docsFilter || type || q ? "/fleet/trailers" : qs({}), <Stat className={tileClass} label="Trailers" value={all.length} hint={`${paired} paired · ${truckCount} tractors`} icon={<Container />} />)}
        {statusTile("IN_USE", "on a load")}
        {statusTile("EMPTY", emptyLoose ? `unloaded · ${emptyLoose} unpaired` : "unloaded, still paired")}
        {statusTile("DROPPED", dropOldest ? `oldest ${daysSince(dropOldest.statusSince)}d · ${dropOldest.unitNumber}` : "at customer sites")}
        {statusTile("YARD", "parked, available")}
        {statusTile("SHOP", shopOldest ? `${shopOldest.unitNumber} in ${daysSince(shopOldest.statusSince)}d` : "none in repair")}
        {statusTile("OUT_OF_SERVICE", "needs decision")}
        {tile(qs({ docs: "incomplete", status: undefined }), <Stat className={tileClass} label="Docs incomplete" value={incomplete} hint="registration, insurance, inspection" tone={incomplete ? "warn" : "ok"} icon={<FileCheck />} />)}
        {tile(qs({ docs: "expiring", status: undefined }), <Stat className={tileClass} label="Docs expiring" value={expiringUnits} hint={expiringHint} tone={expiredUnits ? "danger" : expiringUnits ? "warn" : "ok"} icon={<CalendarClock />} />)}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills active={status ?? "all"} items={[
            { key: "all", label: "All", href: qs({ status: undefined }), count: all.length },
            ...TRAILER_STATUSES.map((s) => ({ key: s, label: TRAILER_STATUS_LABELS[s], href: qs({ status: s }), count: byStatus(s).length })),
          ]} />
          {docsFilter && <Link href={qs({ docs: undefined })} className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[12px] font-medium text-accent-text hover:opacity-80">{docsFilter === "expiring" ? "Docs expiring" : "Docs incomplete"}<X className="h-3 w-3" /></Link>}
        </div>
        <ListFilters basePath="/fleet/trailers" params={params} placeholder="Unit, plate, truck, driver, place…" selects={[
          { name: "type", label: "Type", placeholder: "All types", options: EQUIPMENT.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] })) },
        ]} />
      </div>

      <Card flush>
        {capped && (
          <p className="border-b border-line bg-info-soft px-4 py-2 text-[12px] text-info">
            Showing the first <span className="num">{trailers.length}</span> of <span className="num">{matching}</span> matching trailers. Narrow the search or filters to see the rest.
          </p>
        )}
        <Table head={["Unit",
          <span key="status" className="inline-flex items-center gap-1">Status<InfoTip>The small number next to a status is how long the trailer has been in it.</InfoTip></span>,
          "Paired truck", "Driver", "Location", "GPS", "Capacity", "Inspection", "Insurance", "Registration", "Documents", ""]}>
          {trailers.map((t) => {
            const missing = missingFor(t.id);
            const onFile = REQUIRED_UNIT_DOCS.length - missing.length;
            const load = t.loads[0];
            const paper = paperworkExpiry(t, docExpiry.get(t.id));
            return (
              <LinkRow key={t.id} href={`/fleet/trailers/${t.id}`}>
                <td title={[t.year, t.plate].filter(Boolean).join(" · ") || undefined}>
                  <Cell mono primary={<Link href={`/fleet/trailers/${t.id}`} className="font-semibold hover:underline">{t.unitNumber}</Link>}
                    secondary={EQUIPMENT_LABELS[t.type] ?? t.type} />
                </td>
                <td className="whitespace-nowrap"><TrailerStatusControl id={t.id} status={t.status} locationName={t.locationName} editable={editable} since={sinceShort(t.statusSince)} /></td>
                <td>
                  {t.truck ? (
                    <Cell mono primary={<Link href={`/fleet/${t.truck.id}`} className="font-medium hover:underline">{t.truck.unitNumber}</Link>}
                      secondary={load ? <Link href={`/loads/${load.id}`} className="hover:underline">{load.reference}</Link> : undefined} />
                  ) : <span className="text-fg-faint">—</span>}
                </td>
                <td>{t.truck?.driver ? <Link href={`/drivers/${t.truck.driver.id}`} className="hover:underline">{t.truck.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
                <td title={t.lastPingAt ? `Last position ${ago(t.lastPingAt)}` : t.gpsProvider ? "No ping yet" : "No tracker"}>
                  {/* The age of the position only shows when it is old or missing; the GPS column already says when there is no tracker. */}
                  <Cell primary={t.locationName ?? <span className="text-fg-faint">Unknown</span>}
                    secondary={t.lastPingAt ? (pingStale(t.lastPingAt) ? ago(t.lastPingAt) : undefined) : t.gpsProvider ? "no ping yet" : undefined} />
                </td>
                <td className="whitespace-nowrap">{t.gpsProvider ?? <span className="text-fg-faint">None</span>}</td>
                <td className="num whitespace-nowrap text-fg-muted">{kg(t.capacityKg)}</td>
                <td><ExpiryBadge days={daysUntil(paper.INSPECTION)} /></td>
                <td><ExpiryBadge days={daysUntil(paper.INSURANCE)} /></td>
                <td><ExpiryBadge days={daysUntil(paper.REGISTRATION)} /></td>
                <td>
                  <Badge value="DOCS" tone={onFile === REQUIRED_UNIT_DOCS.length ? "ok" : onFile === 0 ? "neutral" : "warn"} label={`${onFile}/${REQUIRED_UNIT_DOCS.length}`}
                    className={cn("num", onFile === 0 && "text-fg-subtle")} />
                </td>
                <td className="text-right"><TrailerRowMenu id={t.id} truckId={t.truckId} editable={editable} /></td>
              </LinkRow>
            );
          })}
        </Table>
        {trailers.length === 0 && (
          all.length === 0
            ? <EmptyState title="No trailers yet" description="Add your trailers to pair them with tractors and track where each one is." action={editable && <LinkButton href="/fleet/trailers/new"><Plus />Add trailer</LinkButton>} />
            : <EmptyState title="No trailers match" description="Try another status or type, or clear the search." action={<LinkButton href="/fleet/trailers" variant="secondary">Clear filters</LinkButton>} />
        )}
      </Card>
    </>
  );
}
