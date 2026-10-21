import { Check, Download, ExternalLink, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileType, Minus } from "lucide-react";
import type { CurrentUser } from "@/lib/auth";
import { DATED_DOC_KINDS, DOC_KINDS, DOC_KIND_LABELS, UNIT_DOC_SLOTS, canDeleteDoc, canUploadDoc, listDocs, type DocTarget } from "@/lib/documents";
import { daysUntil } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { Badge, Card, Chip, ExpiryBadge, IconTile, cn, type Tone } from "../ui";
import { DocSlot, DocumentUploader } from "./uploader";
import { DeleteDocumentButton } from "./delete-button";

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`);

/** Icon for a file's type (a PDF / paper icon when there is no file yet). */
function FileGlyph({ contentType, className }: { contentType?: string | null; className?: string }) {
  if (!contentType || contentType === "application/pdf") return <FileText className={className} />;
  if (contentType.startsWith("image/")) return <FileImage className={className} />;
  if (/spreadsheet|excel|csv/.test(contentType)) return <FileSpreadsheet className={className} />;
  if (/word|text\//.test(contentType)) return <FileType className={className} />;
  return <FileIcon className={className} />;
}

const actionClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg [&_svg]:h-4 [&_svg]:w-4";

type Doc = Awaited<ReturnType<typeof listDocs>>[number];
type Fmt = Awaited<ReturnType<typeof getFormat>>;

/** Expiry soon = within this many days (same window as ExpiryBadge and the alerts). */
const SOON_DAYS = 30;

function earlier(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

/** Valid / expiring / expired / not uploaded, for one slot. */
function slotStatus(doc: Doc | undefined, expiry: Date | null, dated: boolean, required: boolean): { tone: Tone; label: string } {
  if (!doc) return { tone: required ? "warn" : "neutral", label: "Not uploaded" };
  const days = daysUntil(expiry);
  if (days == null) return dated ? { tone: "info", label: "No expiry date" } : { tone: "ok", label: "On file" };
  if (days < 0) return { tone: "danger", label: "Expired" };
  if (days <= SOON_DAYS) return { tone: "warn", label: "Expiring" };
  return { tone: "ok", label: "Valid" };
}

function relDays(days: number) {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

/** View + download (+ delete) for one file. */
function FileActions({ d, deletable, path }: { d: Doc; deletable: boolean; path: string }) {
  return (
    <>
      <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className={actionClass} aria-label={`View ${d.name}`} title="View"><ExternalLink /></a>
      <a href={`/api/documents/${d.id}?download`} className={actionClass} aria-label={`Download ${d.name}`} title="Download"><Download /></a>
      {deletable && <DeleteDocumentButton id={d.id} name={d.name} path={path} />}
    </>
  );
}

/** "230 KB · uploaded by Ana Diaz, Oct 2, 2026" */
function fileLine(d: Doc, f: Fmt) {
  return `${fmtSize(d.size)} · uploaded ${d.uploadedBy?.name ? `by ${d.uploadedBy.name}, ` : ""}${f.date(d.createdAt)}`;
}

/**
 * Documents attached to a truck / trailer / driver / work order / roadside inspection / the company (always of the
 * active company).
 *
 * Trucks and trailers get **fixed slots** (UNIT_DOC_SLOTS: registration, annual inspection, insurance, IFTA, title…),
 * shown even when empty: status (valid / expiring / expired / not uploaded), issued and expiry dates, who uploaded it
 * and when, view / download / replace / delete, and an upload button set to that kind. Anything else (photos, other
 * files) is listed below the slots. A slot is linkable as `#doc-<KIND>`.
 *
 * Other owners keep the plain list; `required` renders a checklist row (ok when on file, warn when missing).
 * Kinds in DATED_DOC_KINDS ask for the issued and expiry dates on upload.
 */
export async function DocumentsPanel({ user, target, path, title = "Documents", withExpiry, camera, defaultKind, plain, required, description, recorded }: {
  user: CurrentUser;
  target: DocTarget;
  /** Path to revalidate after delete (the page this panel sits on). */
  path: string;
  title?: string;
  withExpiry?: boolean;
  camera?: boolean;
  defaultKind?: string;
  /** Render without the Card chrome (embedding inside another card or a mobile page). */
  plain?: boolean;
  /** Document kinds that must be on file for this record. */
  required?: readonly string[];
  /** Quiet line under the checklist / above the list. */
  description?: string;
  /** Expiry dates kept on the unit record per kind (truck.registrationExpiry…): a slot shows the earlier of it and the file's. */
  recorded?: Partial<Record<string, Date | null>>;
}) {
  const f = await getFormat();
  const kinds: readonly string[] = DOC_KINDS[target.type];
  const [docs, uploadOk] = await Promise.all([listDocs(target), Promise.all(kinds.map((k) => canUploadDoc(user, target, k)))]);
  const uploadable = kinds.filter((_, i) => uploadOk[i]);
  const deleteOk = await Promise.all(docs.map((d) => canDeleteDoc(user, d)));
  const deletable = new Set(docs.filter((_, i) => deleteOk[i]).map((d) => d.id));
  const label = (k: string) => DOC_KIND_LABELS[k] ?? k;
  const slots: readonly string[] | null = target.type === "truck" || target.type === "trailer" ? UNIT_DOC_SLOTS[target.type] : null;

  if (slots) {
    const byKind = new Map<string, Doc[]>();
    for (const d of docs) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]); // newest first (listDocs order)
    const others = docs.filter((d) => !slots.includes(d.kind));
    const otherKinds = uploadable.filter((k) => !slots.includes(k));
    const onFile = slots.filter((k) => byKind.has(k)).length;
    const requiredSet = new Set(required ?? []);

    const body = (
      <div>
        {description && <p className="px-4 pb-1 text-[12px] text-fg-muted">{description}</p>}
        <ul className={cn("divide-y divide-line", plain && "rounded-md border border-line")}>
          {slots.map((kind) => {
            const versions = byKind.get(kind) ?? [];
            const doc = versions[0];
            const dated = DATED_DOC_KINDS.includes(kind);
            const rec = recorded?.[kind] ?? null;
            const expiry = doc ? earlier(doc.expiresAt, rec) : rec;
            const st = slotStatus(doc, expiry, dated, requiredSet.has(kind));
            const days = daysUntil(expiry);
            const fromRecord = Boolean(doc && rec && expiry && expiry.getTime() !== doc.expiresAt?.getTime());
            const dates = [
              doc?.issuedAt ? `Issued ${f.date(doc.issuedAt)}` : null,
              expiry ? `${days != null && days < 0 ? "Expired" : "Expires"} ${f.date(expiry)} · ${relDays(days ?? 0)}${fromRecord ? " (from the record)" : ""}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <DocSlot key={kind} id={`doc-${kind}`} target={target} kind={kind} label={label(kind)} dated={dated} hasFile={Boolean(doc)}
                canUpload={uploadable.includes(kind)}
                info={(
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <IconTile size="sm" tone={st.tone}><FileGlyph contentType={doc?.contentType} /></IconTile>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                        {label(kind)}
                        {requiredSet.has(kind) && <Chip className="normal-case tracking-normal">Required</Chip>}
                      </p>
                      {doc ? (
                        <p className="truncate text-[11px] text-fg-subtle">
                          <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="text-fg-muted hover:text-fg hover:underline">{doc.name}</a>
                          {dates && <> · <span className={cn(st.tone === "danger" ? "text-danger" : st.tone === "warn" ? "text-warn" : "")}>{dates}</span></>}
                          {" · "}{fileLine(doc, f)}
                        </p>
                      ) : (
                        <p className="truncate text-[11px] text-fg-subtle">
                          {rec ? `No file yet · the record says it ${daysUntil(rec)! < 0 ? "expired" : "expires"} ${f.date(rec)}` : uploadable.includes(kind) ? "No file yet" : "Nothing uploaded"}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                status={<Badge value={st.label} label={st.label} tone={st.tone} dot />}
                actions={doc && <FileActions d={doc} deletable={deletable.has(doc.id)} path={path} />}>
                {versions.length > 1 && (
                  <details className="group/v px-4 pb-2">
                    <summary className="cursor-pointer list-none text-[11px] font-medium text-fg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
                      {versions.length - 1} earlier file{versions.length > 2 ? "s" : ""}
                    </summary>
                    <ul className="mt-1 space-y-0.5 border-l border-line pl-3">
                      {versions.slice(1).map((v) => (
                        <li key={v.id} className="flex items-center gap-2 text-[11px] text-fg-subtle">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-fg-muted">{v.name}</span>
                            {v.expiresAt && <> · expires {f.date(v.expiresAt)}</>}
                            {" · "}{fileLine(v, f)}
                          </span>
                          <FileActions d={v} deletable={deletable.has(v.id)} path={path} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </DocSlot>
            );
          })}
        </ul>

        {(others.length > 0 || otherKinds.length > 0) && (
          <div className={cn("border-t border-line", plain && "mt-3 rounded-md border")}>
            <p className="px-4 pb-1 pt-3 text-[12px] font-medium text-fg-muted">Photos and other files</p>
            {others.length === 0 ? (
              <p className="px-4 pb-2 text-[12px] text-fg-subtle">Nothing else attached.</p>
            ) : (
              <ul className="divide-y divide-line">
                {others.map((d) => <FileRow key={d.id} d={d} f={f} label={label(d.kind)} deletable={deletable.has(d.id)} path={path} />)}
              </ul>
            )}
            {otherKinds.length > 0 && (
              <div className="bg-sunken/40 px-4 py-3">
                <DocumentUploader target={target} kinds={otherKinds} labels={DOC_KIND_LABELS} datedKinds={DATED_DOC_KINDS} camera={camera}
                  defaultKind={defaultKind && otherKinds.includes(defaultKind) ? defaultKind : undefined} />
              </div>
            )}
          </div>
        )}
      </div>
    );

    if (plain) return body;
    return (
      <Card title={title} flush actions={<span className="num text-[11px] text-fg-subtle">{onFile} of {slots.length} on file</span>}>
        {body}
      </Card>
    );
  }

  const have = new Set(docs.map((d) => d.kind));
  const missing = (required ?? []).filter((k) => !have.has(k));
  const canUpload = uploadable.length > 0;

  const checklist = required && required.length > 0 && (
    <div className={cn("flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2", plain && "rounded-md border bg-sunken/50")}>
      <span className="eyebrow mr-1">Required</span>
      {required.map((k) => {
        const ok = have.has(k);
        return (
          <Chip key={k} tone={ok ? "ok" : "warn"} title={ok ? `${label(k)} on file` : `${label(k)} missing`} className="gap-1 normal-case tracking-normal">
            {ok ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {label(k)}
          </Chip>
        );
      })}
      <span className="num ml-auto text-[11px] text-fg-subtle">{required.length - missing.length}/{required.length} on file</span>
    </div>
  );

  const emptyHint = canUpload
    ? missing.length
      ? `Upload the ${missing.map((k) => label(k).toLowerCase()).join(", ")} to complete this record.`
      : "Use Upload below, or drop files onto the uploader."
    : "Nothing has been uploaded for this record.";

  const body = (
    <div className={cn(plain && "space-y-3")}>
      {checklist}
      {description && <p className={cn("text-[12px] text-fg-muted", !plain && "px-4 pt-3")}>{description}</p>}
      {docs.length === 0 ? (
        <div className={cn("py-6 text-center", !plain && "px-4")}>
          <p className="text-[13px] font-medium text-fg">No documents yet</p>
          <p className="mx-auto mt-0.5 max-w-sm text-[12px] text-fg-muted">{emptyHint}</p>
        </div>
      ) : (
        <ul className={cn("divide-y divide-line", plain && "rounded-md border border-line")}>
          {docs.map((d) => <FileRow key={d.id} d={d} f={f} label={label(d.kind)} deletable={deletable.has(d.id)} path={path} />)}
        </ul>
      )}
      {canUpload && (
        <div className={cn(!plain && "border-t border-line bg-sunken/40 px-4 py-3")}>
          <DocumentUploader target={target} kinds={uploadable} labels={DOC_KIND_LABELS} withExpiry={withExpiry} camera={camera} datedKinds={DATED_DOC_KINDS}
            defaultKind={defaultKind && uploadable.includes(defaultKind) ? defaultKind : undefined} />
        </div>
      )}
    </div>
  );

  if (plain) return body;
  return (
    <Card title={title} flush actions={docs.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{docs.length}</span>}>
      {body}
    </Card>
  );
}

/** One file in the plain list. */
function FileRow({ d, f, label, deletable, path }: { d: Doc; f: Fmt; label: string; deletable: boolean; path: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-raised">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-subtle">
        <FileGlyph contentType={d.contentType} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-fg hover:underline">{d.name}</a>
        <p className="truncate text-[11px] text-fg-subtle">
          <span className="text-fg-muted">{label}</span>
          {d.issuedAt && <>{" · "}issued {f.date(d.issuedAt)}</>}
          {d.expiresAt && <>{" · "}expires {f.date(d.expiresAt)}</>}
          {" · "}<span className="num">{fmtSize(d.size)}</span>
          {" · "}{d.uploadedBy?.name ?? "—"}
          {" · "}{f.date(d.createdAt)}
        </p>
      </div>
      {d.expiresAt && <ExpiryBadge days={daysUntil(d.expiresAt)} />}
      <div className="flex shrink-0 items-center">
        <FileActions d={d} deletable={deletable} path={path} />
      </div>
    </li>
  );
}
