import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DOC_KIND_LABELS, REQUIRED_UNIT_DOCS } from "@/lib/documents";
import { date } from "@/lib/format";
import { Badge, Card, InfoTip, Stat, Table } from "@/components/ui";
import { DOC_STATE_LABEL, DOC_STATE_TONE, type ComplianceRow, type UnitDoc, type unitCompliance } from "../_lib/data";
import { UnitLink } from "./unit-link";

type Data = Awaited<ReturnType<typeof unitCompliance>>;

function DocCell({ d }: { d: UnitDoc }) {
  if (d.state === "ok") return <span className="num text-[12px] text-fg-muted" title="On file">{d.expiresAt ? date(d.expiresAt) : "On file"}</span>;
  const label = d.state === "expired" ? `Expired ${-(d.days ?? 0)}d ago` : d.state === "expiring" ? `${d.days}d left` : "Missing";
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge value={d.state} tone={DOC_STATE_TONE[d.state]} label={label} className="num" />
      {!d.onFile && d.state !== "missing" && <span className="text-[10px] text-fg-subtle" title="The date comes from the unit record; no file has been uploaded.">no file</span>}
    </div>
  );
}

function nextStep(r: ComplianceRow) {
  const kind = (k: string) => (DOC_KIND_LABELS[k] ?? k).toLowerCase();
  const expired = r.docs.filter((d) => d.state === "expired");
  const expiring = r.docs.filter((d) => d.state === "expiring");
  const missing = r.docs.filter((d) => d.state === "missing");
  if (expired.length) return `Renew ${expired.map((d) => kind(d.kind)).join(", ")}`;
  if (expiring.length) return `Book renewal: ${expiring.map((d) => kind(d.kind)).join(", ")}`;
  if (missing.length) return `Upload ${missing.map((d) => kind(d.kind)).join(", ")}`;
  return "All paperwork on file";
}

export function ComplianceTab({ data }: { data: Data }) {
  const { rows, units, documents } = data;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expired" value={units.expired} tone={units.expired ? "danger" : "ok"} hint={units.expired ? `${documents.expired} documents · fix first` : "nothing expired"} />
        <Stat label="Expiring within 30 days" value={units.expiring} tone={units.expiring ? "warn" : "neutral"} hint={units.expiring ? `${documents.expiring} renewals to book` : "no renewals due"} />
        <Stat label="Missing paperwork" value={units.missing} tone={units.missing ? "info" : "neutral"} hint={documents.missing ? `${documents.missing} documents never uploaded` : "every required document is on file"} />
        <Stat label="Complete" value={units.ok} tone="ok" hint={`of ${rows.length} active units`} />
      </div>

      <Card className="mt-4" flush title={<span className="flex items-center gap-1.5">Unit paperwork<InfoTip>Triage order: expired, then expiring, then missing.</InfoTip></span>}>
        <Table head={["Unit", ...REQUIRED_UNIT_DOCS.map((k) => DOC_KIND_LABELS[k] ?? k), "Next step", ""]} empty={rows.length === 0}
          emptyTitle="No active units" emptyDescription="Trucks and trailers appear here with the state of their registration, insurance and inspection documents.">
          {rows.map((r) => (
            <tr key={`${r.type}:${r.id}`} className={r.worst === "ok" ? "text-fg-muted" : undefined}>
              <td title={r.detail}>
                <UnitLink truck={r.type === "truck" ? { id: r.id, unitNumber: r.unitNumber } : null} trailer={r.type === "trailer" ? { id: r.id, unitNumber: r.unitNumber } : null} />
              </td>
              {r.docs.map((d) => <td key={d.kind} className="whitespace-nowrap"><DocCell d={d} /></td>)}
              <td className="max-w-72 truncate" title={r.worst !== "ok" ? DOC_STATE_LABEL[r.worst] : undefined}>
                <span className={r.worst === "ok" ? "text-fg-subtle" : "text-fg"}>{nextStep(r)}</span>
              </td>
              <td className="text-right">
                <Link href={r.href} className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-medium text-fg-muted hover:text-fg">
                  {r.type === "truck" ? "Compliance" : "Documents"} <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
