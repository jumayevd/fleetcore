import { Check, Download, ExternalLink, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileType, Minus } from "lucide-react";
import type { CurrentUser } from "@/lib/auth";
import { DOC_KINDS, DOC_KIND_LABELS, canDeleteDoc, canUploadDoc, listDocs, type DocTarget } from "@/lib/documents";
import { date, daysUntil } from "@/lib/format";
import { Card, Chip, ExpiryBadge, cn } from "../ui";
import { DocumentUploader } from "./uploader";
import { DeleteDocumentButton } from "./delete-button";

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`);

function iconFor(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType === "application/pdf") return FileText;
  if (/spreadsheet|excel|csv/.test(contentType)) return FileSpreadsheet;
  if (/word|text\//.test(contentType)) return FileType;
  return FileIcon;
}

const actionClass = "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-sunken hover:text-fg [&_svg]:h-4 [&_svg]:w-4";

/**
 * Documents attached to a load / truck / trailer / driver / customer / work order / claim / company.
 * `required` renders a checklist row (ok when on file, warn when missing) — loads pass ["RC","BOL","POD"],
 * units pass REQUIRED_UNIT_DOCS.
 */
export async function DocumentsPanel({ user, target, path, title = "Documents", withExpiry, camera, defaultKind, plain, required, description }: {
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
}) {
  // Checks start in the same tick: a driver's per-kind "is this my load?" lookups are identical
  // findUnique calls, which Prisma's dataloader batches into one query instead of one per kind.
  const kinds: readonly string[] = DOC_KINDS[target.type];
  const [docs, uploadOk] = await Promise.all([listDocs(target), Promise.all(kinds.map((k) => canUploadDoc(user, target, k)))]);
  const uploadable = kinds.filter((_, i) => uploadOk[i]);
  const deleteOk = await Promise.all(docs.map((d) => canDeleteDoc(user, d)));
  const deletable = new Set(docs.filter((_, i) => deleteOk[i]).map((d) => d.id));

  const have = new Set(docs.map((d) => d.kind));
  const missing = (required ?? []).filter((k) => !have.has(k));
  const canUpload = uploadable.length > 0;
  const label = (k: string) => DOC_KIND_LABELS[k] ?? k;

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
          {docs.map((d) => {
            const Icon = iconFor(d.contentType);
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2 hover:bg-raised">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-subtle">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-fg hover:underline">{d.name}</a>
                  <p className="truncate text-[11px] text-fg-subtle">
                    <span className="text-fg-muted">{label(d.kind)}</span>
                    {" · "}<span className="num">{fmtSize(d.size)}</span>
                    {" · "}{d.uploadedBy?.name ?? "—"}
                    {" · "}{date(d.createdAt)}
                  </p>
                </div>
                {d.expiresAt && <ExpiryBadge days={daysUntil(d.expiresAt)} />}
                <div className="flex shrink-0 items-center">
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className={actionClass} aria-label={`Open ${d.name}`} title="Open"><ExternalLink /></a>
                  <a href={`/api/documents/${d.id}?download`} className={actionClass} aria-label={`Download ${d.name}`} title="Download"><Download /></a>
                  {deletable.has(d.id) && <DeleteDocumentButton id={d.id} name={d.name} path={path} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canUpload && (
        <div className={cn(!plain && "border-t border-line bg-sunken/40 px-4 py-3")}>
          <DocumentUploader target={target} kinds={uploadable} labels={DOC_KIND_LABELS} withExpiry={withExpiry} camera={camera}
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
