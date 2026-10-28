import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil, Phone, Wrench } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EQUIPMENT_LABELS, REPAIR_STAGE_LABELS, TRAILER_STATUS_LABELS } from "@/lib/constants";
import { REQUIRED_UNIT_DOCS, DOC_KIND_LABELS, UNIT_DOC_SLOTS } from "@/lib/documents";
import { ago, daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Badge, Card, DL, ExpiryBadge, LinkButton, PageHeader, Stat } from "@/components/ui";
import { LeafletMap } from "@/components/map";
import { DocumentsPanel } from "@/components/documents/panel";
import { UnitRepairs } from "@/components/fleet/unit-repairs";
import { UnitDefects } from "@/components/fleet/unit-defects";
import { UnitSafetyHistory } from "@/components/fleet/unit-safety";
import { CompletenessCard, FixLink, FixNote, TrailerFix, type Prompt } from "../../[id]/complete";
import { CompletedRepairs } from "../../repair-history";
import { openDefects, openRepairs } from "../../data";
import { docExpiryByUnit, missingDocs, paperworkExpiry, pingStale, recordedExpiry, sinceShort, TRUCK_STATUS_LABELS } from "../../lib";
import { TrailerStatusControl } from "../status-control";

export async function generateMetadata({ params }: PageProps<"/fleet/trailers/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.trailer.findUnique({ where: { id: (await params).id }, select: { unitNumber: true } });
  return { title: r?.unitNumber ?? "Not found" };
}

/** The trailer page is one page of sections; tab links (shared with the truck page) land on the matching section. */
const TAB_SECTIONS: Record<string, string> = { documents: "documents", compliance: "documents", maintenance: "repairs", history: "history", defects: "defects" };

export default async function TrailerDetail({ params, searchParams }: PageProps<"/fleet/trailers/[id]">) {
  const user = await requireUser("fleet.view");
  const f = await getFormat();
  const { id } = await params;
  const tab = (await searchParams).tab;
  if (typeof tab === "string" && TAB_SECTIONS[tab]) redirect(`/fleet/trailers/${id}#${TAB_SECTIONS[tab]}`);
  const editable = can(user.role, "fleet.edit");
  const showMoney = can(user.role, "money.view");

  const trailer = await db.trailer.findUnique({
    where: { id },
    include: { truck: { select: { id: true, unitNumber: true, make: true, model: true, status: true, driver: { select: { id: true, name: true, phone: true, dispatcher: true } } } } },
  });
  if (!trailer) notFound();
  const [docRows, repairs, defects] = await Promise.all([
    db.document.findMany({ where: { trailerId: id, kind: { in: [...UNIT_DOC_SLOTS.trailer] } }, orderBy: { createdAt: "desc" }, select: { kind: true, expiresAt: true } }),
    openRepairs("trailer", [id]),
    openDefects("trailer", [id]),
  ]);
  const repair = repairs.get(id);
  const defect = defects.get(id);
  const have = new Set(docRows.map((d) => d.kind));
  const missing = missingDocs(have, REQUIRED_UNIT_DOCS);
  // Same rule as the trailer list: the earlier of the record date and the newest uploaded document's expiry.
  const paper = paperworkExpiry(trailer, docExpiryByUnit(docRows.map((d) => ({ id, kind: d.kind, expiresAt: d.expiresAt }))).get(id));
  const typeLabel = EQUIPMENT_LABELS[trailer.type] ?? trailer.type;
  const newRepair = `/maintenance/work-orders/new?trailer=${id}`;
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";
  const inspectionDays = daysUntil(paper.INSPECTION);

  const prompts: Prompt[] = [];
  if (!have.has("REGISTRATION")) {
    prompts.push({ key: "reg", text: "No registration on file", hint: "DOT inspectors and the paperwork alerts look for it.",
      fix: editable ? <FixLink href="#doc-REGISTRATION">Attach</FixLink> : <FixNote href="#documents">See documents</FixNote> });
  }
  if (!trailer.plate?.trim()) prompts.push({ key: "plate", text: "Add the plate", fix: editable ? <TrailerFix trailerId={id} field="plate" /> : undefined });
  if (!trailer.inspectionExpiry) {
    prompts.push({ key: "inspection", text: "Add the annual inspection date", hint: "When the next annual inspection is due, so it shows up 30 days ahead.",
      fix: editable ? <TrailerFix trailerId={id} field="inspectionExpiry" /> : undefined });
  }

  return (
    <>
      <PageHeader
        title={<span className="num">{trailer.unitNumber}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrailerStatusControl id={id} status={trailer.status} locationName={trailer.locationName} editable={editable} since={`${sinceShort(trailer.statusSince)} · since ${f.date(trailer.statusSince)}`} />
            <span>{typeLabel}{trailer.year ? ` · ${trailer.year}` : ""}</span>
            {trailer.plate && <span>Plate <span className="num text-fg">{trailer.plate}</span></span>}
          </span>
        }
        actions={editable && (
          <>
            <LinkButton href={`/fleet/trailers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
            <LinkButton href={newRepair}><Wrench />Create repair</LinkButton>
          </>
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tile(trailer.truck ? `/fleet/${trailer.truck.id}` : editable ? `/fleet/trailers/${id}/edit` : "#pairing",
          <Stat className={tileClass} label="Paired truck" value={trailer.truck ? trailer.truck.unitNumber : "—"}
            hint={trailer.truck ? `${trailer.truck.make} ${trailer.truck.model}${trailer.truck.driver ? ` · ${trailer.truck.driver.name}` : ""}` : "not paired with a truck"} tone={trailer.truck ? "info" : "neutral"} />)}
        {tile(repair ? `/maintenance/work-orders/${repair.id}` : "#repairs",
          <Stat className={tileClass} label="Open repair" value={repair ? roLabel(repair.number) : "None"}
            hint={repair ? (repair.status === "IN_PROGRESS" ? (repair.stage ? REPAIR_STAGE_LABELS[repair.stage] ?? repair.stage : "In the shop") : `Scheduled ${f.day(repair.scheduledAt)}`) : "nothing open"}
            tone={repair?.status === "IN_PROGRESS" ? "warn" : "neutral"} />)}
        {tile("#defects", <Stat className={tileClass} label="Open defects" value={defect?.open ?? 0}
          hint={defect?.urgent ? `${defect.urgent} to fix before the next load` : defect ? "none urgent" : "nothing reported"} tone={defect?.urgent ? "danger" : defect ? "warn" : "neutral"} />)}
        {tile("#doc-INSPECTION", <Stat className={tileClass} label="Annual inspection" value={paper.INSPECTION ? f.day(paper.INSPECTION) : "—"}
          hint={inspectionDays == null ? "no date recorded" : inspectionDays < 0 ? `expired ${-inspectionDays}d ago` : `due in ${inspectionDays}d`}
          tone={inspectionDays == null ? "neutral" : inspectionDays < 0 ? "danger" : inspectionDays <= 30 ? "warn" : "neutral"} />)}
        {tile("#documents", <Stat className={tileClass} label="Paperwork" value={`${REQUIRED_UNIT_DOCS.length - missing.length}/${REQUIRED_UNIT_DOCS.length}`}
          hint={missing.length ? `missing ${missing.map((m) => DOC_KIND_LABELS[m].toLowerCase()).join(", ")}` : "all required documents on file"} tone={missing.length ? "warn" : "ok"} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <CompletenessCard prompts={prompts} unitLabel={trailer.unitNumber} />
          <div id="repairs" className="scroll-mt-20"><UnitRepairs unit={{ type: "trailer", id }} editable={editable} /></div>
          <div id="defects" className="scroll-mt-20"><UnitDefects unit={{ type: "trailer", id }} editable={editable} /></div>
          <div id="documents" className="scroll-mt-20">
            <DocumentsPanel user={user} target={{ type: "trailer", id }} path={`/fleet/trailers/${id}`} required={[...REQUIRED_UNIT_DOCS]} recorded={recordedExpiry(trailer)} />
          </div>
          <div id="history" className="scroll-mt-20 space-y-4">
            <UnitSafetyHistory unit={{ type: "trailer", id }} />
            <CompletedRepairs unit={{ type: "trailer", id }} showMoney={showMoney} limit={20} />
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
                ["Status since", `${f.date(trailer.statusSince)} · ${sinceShort(trailer.statusSince)}`],
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
                    <div className="min-w-0">
                      <Link href={`/drivers/${trailer.truck.driver.id}`} className="text-[13px] font-medium text-fg hover:underline">{trailer.truck.driver.name}</Link>
                      {trailer.truck.driver.dispatcher && <p className="truncate text-[11px] text-fg-subtle">Dispatch {trailer.truck.driver.dispatcher}</p>}
                    </div>
                    {trailer.truck.driver.phone && <a href={`tel:${trailer.truck.driver.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-muted hover:bg-raised hover:text-fg"><Phone className="h-3.5 w-3.5" />Call</a>}
                  </div>
                ) : <p className="text-[13px] text-fg-muted">{trailer.truck ? "The paired truck has no driver" : "—"}</p>}
              </div>
            </div>
          </Card>

          <Card title="Unit" actions={editable && <LinkButton href={`/fleet/trailers/${id}/edit`} variant="ghost" size="sm"><Pencil />Edit</LinkButton>}>
            <DL items={[
              ["Type", typeLabel],
              ["Capacity", <span key="c" className="num">{f.weight(trailer.capacityKg)}</span>],
              ["Plate", trailer.plate ? <span key="p" className="num">{trailer.plate}</span> : "—"],
              ["Year", trailer.year ? <span key="y" className="num">{trailer.year}</span> : "—"],
              ["Annual inspection", <span key="n" className="inline-flex items-center gap-1.5">{paper.INSPECTION && <span className="num">{f.date(paper.INSPECTION)}</span>}<ExpiryBadge days={inspectionDays} /></span>],
              ["Insurance", <ExpiryBadge key="i" days={daysUntil(paper.INSURANCE)} />],
              ["Registration", <ExpiryBadge key="r" days={daysUntil(paper.REGISTRATION)} />],
              ["Added", f.date(trailer.createdAt)],
              ["Status", TRAILER_STATUS_LABELS[trailer.status] ?? trailer.status],
            ]} />
            {trailer.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-[12px] leading-5 text-fg-muted">{trailer.notes}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
