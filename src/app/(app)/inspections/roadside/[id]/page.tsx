import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { INSPECTION_LEVEL_LABELS } from "@/lib/constants";
import {
  ROADSIDE_RESULT_TONE, ROADSIDE_STATUS_TONE, VIOLATION_UNIT_LABELS, daysBetween, plural, roadsideResultLabel, roadsideStatusLabel,
} from "@/lib/pti-shared";
import { Badge, Card, Chip, DL, EmptyState, LinkButton, PageHeader, StatusDot, Table, cn } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents/panel";
import { RoadsideStatusButtons, ViolationToggle } from "@/components/inspections/roadside-actions";

export async function generateMetadata({ params }: PageProps<"/inspections/roadside/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.roadsideInspection.findUnique({ where: { id: (await params).id }, select: { reportNumber: true } });
  return { title: r ? (r.reportNumber ? `Roadside ${r.reportNumber}` : "Roadside inspection") : "Not found" };
}

export default async function RoadsideDetail({ params }: PageProps<"/inspections/roadside/[id]">) {
  const me = await requireUser("fleet.view");
  const editable = can(me.role, "fleet.edit");
  const f = await getFormat();
  const { id } = await params;
  const r = await db.roadsideInspection.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true } },
      truck: { select: { id: true, unitNumber: true, make: true, model: true } },
      trailer: { select: { id: true, unitNumber: true } },
      createdBy: { select: { name: true } },
      violations: { orderBy: { id: "asc" } },
    },
  });
  if (!r) notFound();
  const now = new Date();
  const uncorrected = r.violations.filter((v) => !v.correctedAt).length;
  const late = r.status === "OPEN" && r.correctionDueAt != null && r.correctionDueAt.getTime() < now.getTime();
  const place = [r.location, r.state].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title={r.reportNumber ? <span className="num">Report {r.reportNumber}</span> : `Roadside inspection, ${f.date(r.inspectedAt)}`}
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge value={r.result} label={roadsideResultLabel(r.result)} tone={ROADSIDE_RESULT_TONE[r.result]} dot />
            <Badge value={r.status} label={roadsideStatusLabel(r.status)} tone={ROADSIDE_STATUS_TONE[r.status]} />
            <span className="num">{f.dateTime(r.inspectedAt)} {f.zone(r.inspectedAt)}</span>
            <span>{INSPECTION_LEVEL_LABELS[r.level] ?? `Level ${r.level}`}</span>
            {place && <span>{place}</span>}
          </span>
        }
        actions={editable && (
          <>
            <RoadsideStatusButtons id={r.id} status={r.status} uncorrected={uncorrected} />
            <LinkButton href={`/inspections/roadside/${r.id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
          </>
        )}
      />

      {late && (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          <StatusDot tone="danger" />Correction was due {f.date(r.correctionDueAt)}, {plural(daysBetween(r.correctionDueAt!, now), "day")} ago. {plural(uncorrected, "violation")} still to correct.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Violations" flush actions={r.violations.length > 0 && (
            <span className="text-[12px] text-fg-subtle">{uncorrected ? `${uncorrected} of ${r.violations.length} to correct` : "All corrected"}</span>
          )}>
            {r.violations.length === 0 ? (
              <EmptyState title="Clean inspection" description="No violations were written up. Nothing to correct." />
            ) : (
              <Table stickyHead={false} head={["Code", "Violation", "Unit", "Out of service", "Corrected", ""]}>
                {r.violations.map((v) => (
                  <tr key={v.id} className={cn(v.oos && !v.correctedAt && "bg-danger-soft/40")}>
                    <td className="num whitespace-nowrap font-medium">{v.code ?? <span className="font-normal text-fg-faint">—</span>}</td>
                    <td className="max-w-96 whitespace-normal">{v.description}</td>
                    <td className="whitespace-nowrap text-fg-muted">{VIOLATION_UNIT_LABELS[v.unit] ?? v.unit}</td>
                    <td>{v.oos ? <Chip tone="danger">Out of service</Chip> : <span className="text-fg-faint">No</span>}</td>
                    <td className="whitespace-nowrap">{v.correctedAt ? <span className="text-ok">{f.date(v.correctedAt)}</span> : <span className="text-warn">Not yet</span>}</td>
                    <td className="text-right">{editable && <ViolationToggle id={v.id} corrected={Boolean(v.correctedAt)} disabled={r.status === "CLOSED"} />}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {r.notes && (
            <Card title="Notes"><p className="whitespace-pre-wrap text-[13px] text-fg">{r.notes}</p></Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <DL cols={1} items={[
              ["Driver", r.driver ? <Link href={`/drivers/${r.driver.id}`} className="hover:underline">{r.driver.name}</Link> : "—"],
              ["Truck", r.truck ? <Link href={`/fleet/${r.truck.id}`} className="hover:underline"><span className="num">{r.truck.unitNumber}</span> · {r.truck.make} {r.truck.model}</Link> : "—"],
              ["Trailer", r.trailer ? <Link href={`/fleet/trailers/${r.trailer.id}`} className="num hover:underline">{r.trailer.unitNumber}</Link> : "—"],
              ["Correction due", r.correctionDueAt ? <span className={cn("num", late && "text-danger")}>{f.date(r.correctionDueAt)}</span> : "—"],
              ["Logged", `${f.date(r.createdAt)}${r.createdBy ? ` by ${r.createdBy.name}` : ""}`],
            ]} />
          </Card>
          <DocumentsPanel user={me} target={{ type: "roadside", id: r.id }} path={`/inspections/roadside/${r.id}`} title="Report and proof" defaultKind="INSPECTION_REPORT"
            description={r.violations.length ? "Attach the inspection report and the proof of each correction." : undefined} />
        </div>
      </div>
    </>
  );
}
