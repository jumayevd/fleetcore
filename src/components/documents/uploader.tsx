"use client";

import { useId, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, RefreshCw, Upload } from "lucide-react";
import { buttonClass, cn, inputClass } from "../ui";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,image/*,.doc,.docx,.xls,.xlsx,.txt,.csv";

/** Shrink phone photos (often 4–8 MB) to ≤2000px JPEG before upload. */
async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.2 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

type Status = { tone: "ok" | "err" | "busy"; text: string };
type Target = { type: string; id: string };
/** Dates as typed in <input type="date"> (company time; the upload API reads them that way). */
type Dates = { issuedAt?: string; expiresAt?: string };

/** POST each file to /api/documents. Reports progress through `onStatus`; resolves to how many were uploaded. */
async function sendFiles(list: File[], target: Target, kind: string, dates: Dates, onStatus: (s: Status) => void) {
  let done = 0;
  const failed: string[] = [];
  for (const original of list) {
    onStatus({ tone: "busy", text: list.length > 1 ? `Uploading ${done + failed.length + 1} of ${list.length}: ${original.name}` : `Uploading ${original.name}…` });
    const file = await compressImage(original);
    if (file.size > MAX_BYTES) { failed.push(`${original.name} is over 4 MB`); continue; }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    if (target.type === "company") fd.set("company", "1");
    else fd.set(`${target.type}Id`, target.id);
    if (dates.expiresAt) fd.set("expiresAt", dates.expiresAt);
    if (dates.issuedAt) fd.set("issuedAt", dates.issuedAt);
    const res = await fetch("/api/documents", { method: "POST", body: fd }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "network error" };
    if (!res?.ok) { failed.push(`${original.name}: ${data.error ?? "upload failed"}`); continue; }
    done++;
  }
  if (failed.length) onStatus({ tone: "err", text: (done ? `${done} uploaded. ` : "") + failed.join(" · ") });
  else onStatus({ tone: "ok", text: done === 1 ? "Uploaded" : `${done} files uploaded` });
  return done;
}

/** Issued + expiry date inputs (both optional). */
function DateInputs({ dates, onChange, issued = true, className, touch }: {
  dates: Dates; onChange: (d: Dates) => void; issued?: boolean; className?: string; touch?: boolean;
}) {
  const id = useId();
  const input = cn(inputClass, touch ? "h-11 w-full text-[14px]" : "h-7 w-[9.5rem] text-[12px]");
  const label = cn("flex items-center gap-1.5 text-[11px] text-fg-subtle", touch && "w-full flex-col items-stretch gap-1 text-[12px]");
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {issued && (
        <label htmlFor={`${id}-i`} className={label}>Issued
          <input id={`${id}-i`} type="date" value={dates.issuedAt ?? ""} onChange={(e) => onChange({ ...dates, issuedAt: e.target.value })} className={input} />
        </label>
      )}
      <label htmlFor={`${id}-e`} className={label}>Expires
        <input id={`${id}-e`} type="date" value={dates.expiresAt ?? ""} min={dates.issuedAt || undefined}
          onChange={(e) => onChange({ ...dates, expiresAt: e.target.value })} className={input} />
      </label>
    </div>
  );
}

// The file inputs are visually hidden, so the label shows the keyboard focus ring instead.
const fileLabel = "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent";

/**
 * Compact uploader: kind select, dates, Upload button, and a camera button only when `camera` is set (driver phones).
 * Kinds in `datedKinds` ask for the issued and expiry dates; with `withExpiry`, other kinds ask for an expiry only.
 * The whole block is a drop target.
 */
export function DocumentUploader({ target, kinds, labels, defaultKind, withExpiry, camera, datedKinds = [] }: {
  target: Target;
  kinds: readonly string[];
  labels: Record<string, string>;
  defaultKind?: string;
  withExpiry?: boolean;
  camera?: boolean;
  /** Kinds that carry an issued and an expiry date (DATED_DOC_KINDS). */
  datedKinds?: readonly string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(defaultKind ?? kinds[0]);
  const [dates, setDates] = useState<Dates>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = status?.tone === "busy";
  const dated = datedKinds.includes(kind);
  const askDates = dated || withExpiry;

  async function upload(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    const done = await sendFiles(list, target, kind, askDates ? { expiresAt: dates.expiresAt, issuedAt: dated ? dates.issuedAt : undefined } : {}, setStatus);
    if (fileRef.current) fileRef.current.value = "";
    if (done) { setDates({}); router.refresh(); }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) void upload(e.dataTransfer.files);
  };

  const size = camera ? "md" : "sm";
  // Driver phones: every control in the camera layout is a 44 px touch target.
  const touch = camera && "h-11 text-[14px]";
  const hint = askDates
    ? "Drop files here. With an expiry date you get a reminder 30 days before it lapses."
    : "Drop files here. PDF, images and Office files up to 4 MB.";

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn("rounded-md border border-dashed p-2 transition-colors", dragging ? "border-accent bg-accent-soft" : "border-line-strong")}
    >
      <div className={cn("flex flex-wrap items-center gap-2", camera && "flex-col items-stretch")}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type"
          className={cn(inputClass, camera ? cn("w-full", touch) : "h-7 w-auto min-w-0 flex-1 text-[12px]")}>
          {kinds.map((k) => <option key={k} value={k}>{labels[k] ?? k}</option>)}
        </select>
        {askDates && <DateInputs dates={dates} onChange={setDates} issued={dated} touch={Boolean(camera)} className={cn(camera && "w-full flex-col items-stretch")} />}
        <div className={cn("flex gap-2", camera && "w-full")}>
          <label className={cn(buttonClass("secondary", size), fileLabel, camera && "flex-1", touch, busy && "pointer-events-none opacity-50")}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
            <input ref={fileRef} type="file" multiple className="sr-only" accept={ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files)} />
          </label>
          {camera && (
            <label className={cn(buttonClass("primary", size), fileLabel, "flex-1", touch, busy && "pointer-events-none opacity-50")}>
              <Camera /> Take photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} />
            </label>
          )}
        </div>
      </div>
      <p role={status?.tone === "err" ? "alert" : "status"}
        className={cn("mt-1.5 truncate text-[11px]", status?.tone === "err" ? "text-danger" : status?.tone === "ok" ? "text-ok" : "text-fg-subtle")}
        title={status?.text}>
        {status?.text ?? hint}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One fixed slot (truck / trailer paperwork)                          */
/* ------------------------------------------------------------------ */

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

/**
 * A row of the slot list: what the server rendered (`info`, `status`, `actions`) plus an Upload / Replace button for
 * exactly this kind. A dated kind opens a small form for the issued and expiry dates first; any other kind opens the
 * file picker straight away. A link to `#<id>` (e.g. "Attach the registration") highlights the slot and, when it is
 * empty, opens its form.
 */
export function DocSlot({ id, target, kind, label, dated, hasFile, canUpload = true, info, status, actions, children }: {
  /** Element id, the anchor links point at (`doc-REGISTRATION`). */
  id: string;
  target: Target;
  kind: string;
  label: string;
  dated: boolean;
  hasFile: boolean;
  /** Can the viewer upload? Without it the row shows no Upload / Replace button. */
  canUpload?: boolean;
  info: ReactNode;
  status: ReactNode;
  actions?: ReactNode;
  /** Shown under the row (earlier versions). */
  children?: ReactNode;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const linked = useSyncExternalStore(subscribeHash, () => window.location.hash === `#${id}`, () => false);
  const [picked, setPicked] = useState<boolean | null>(null);
  const [dates, setDates] = useState<Dates>({});
  const [msg, setMsg] = useState<Status | null>(null);
  const open = canUpload && dated && (picked ?? (linked && !hasFile));
  const busy = msg?.tone === "busy";

  async function upload(files: FileList | null) {
    const list = files ? Array.from(files).slice(0, 1) : [];
    if (!list.length) return;
    const done = await sendFiles(list, target, kind, dated ? dates : {}, setMsg);
    if (fileRef.current) fileRef.current.value = "";
    if (done) { setDates({}); setPicked(false); router.refresh(); }
  }

  const verb = hasFile ? "Replace" : "Upload";
  const Icon = hasFile ? RefreshCw : Upload;
  const trigger = !canUpload ? null : dated ? (
    <button type="button" onClick={() => { setMsg(null); setPicked(!open); }} aria-expanded={open}
      className={cn(buttonClass(hasFile ? "ghost" : "secondary", "sm"), open && "bg-raised")}>
      <Icon />{verb}
    </button>
  ) : (
    <label className={cn(buttonClass(hasFile ? "ghost" : "secondary", "sm"), fileLabel, busy && "pointer-events-none opacity-50")} title={`${verb} ${label.toLowerCase()}`}>
      {busy ? <Loader2 className="animate-spin" /> : <Icon />}{verb}
      <input ref={fileRef} type="file" className="sr-only" accept={ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files)} />
    </label>
  );

  return (
    <li id={id} className={cn("scroll-mt-24 transition-colors", linked && "bg-accent-soft/40")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap">
        {info}
        <div className="flex shrink-0 items-center gap-1.5">
          {status}
          {actions}
          {trigger}
        </div>
      </div>
      {open && (
        <div className="mx-4 mb-3 rounded-md border border-dashed border-line-strong bg-sunken/40 p-2">
          <p className="mb-1.5 text-[12px] font-medium text-fg">{hasFile ? `Replace the ${label.toLowerCase()}` : `Upload the ${label.toLowerCase()}`}</p>
          <div className="flex flex-wrap items-center gap-2">
            <DateInputs dates={dates} onChange={setDates} />
            <label className={cn(buttonClass("primary", "sm"), fileLabel, busy && "pointer-events-none opacity-50")}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}Choose file
              <input ref={fileRef} type="file" className="sr-only" accept={ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files)} />
            </label>
            <button type="button" onClick={() => setPicked(false)} className={buttonClass("ghost", "sm")}>Cancel</button>
          </div>
          <p role={msg?.tone === "err" ? "alert" : "status"}
            className={cn("mt-1.5 text-[11px]", msg?.tone === "err" ? "text-danger" : msg?.tone === "ok" ? "text-ok" : "text-fg-subtle")}>
            {msg?.text ?? "Add the dates printed on the paper. The expiry drives the reminder 30 days before it lapses."}
          </p>
        </div>
      )}
      {!open && msg && msg.tone !== "busy" && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={cn("px-4 pb-2 text-[11px]", msg.tone === "err" ? "text-danger" : "text-ok")}>{msg.text}</p>
      )}
      {children}
    </li>
  );
}
