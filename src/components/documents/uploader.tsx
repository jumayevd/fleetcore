"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Upload } from "lucide-react";
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

/**
 * Compact uploader: kind select, optional expiry date, Upload button, and a camera button
 * only when `camera` is set (driver phones). The whole block is a drop target.
 */
export function DocumentUploader({ target, kinds, labels, defaultKind, withExpiry, camera }: {
  target: { type: string; id: string };
  kinds: readonly string[];
  labels: Record<string, string>;
  defaultKind?: string;
  withExpiry?: boolean;
  camera?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(defaultKind ?? kinds[0]);
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = status?.tone === "busy";

  async function upload(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    let done = 0;
    const failed: string[] = [];
    for (const original of list) {
      setStatus({ tone: "busy", text: list.length > 1 ? `Uploading ${done + failed.length + 1} of ${list.length}: ${original.name}` : `Uploading ${original.name}…` });
      const file = await compressImage(original);
      if (file.size > MAX_BYTES) { failed.push(`${original.name} is over 4 MB`); continue; }
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      fd.set(`${target.type}Id`, target.id);
      if (expiresAt) fd.set("expiresAt", expiresAt);
      const res = await fetch("/api/documents", { method: "POST", body: fd }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : { error: "network error" };
      if (!res?.ok) { failed.push(`${original.name}: ${data.error ?? "upload failed"}`); continue; }
      done++;
    }
    if (fileRef.current) fileRef.current.value = "";
    if (failed.length) setStatus({ tone: "err", text: (done ? `${done} uploaded. ` : "") + failed.join(" · ") });
    else setStatus({ tone: "ok", text: done === 1 ? "Uploaded" : `${done} files uploaded` });
    if (done) { setExpiresAt(""); router.refresh(); }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) void upload(e.dataTransfer.files);
  };

  const size = camera ? "md" : "sm";
  // Driver phones: every control in the camera layout is a 44 px touch target.
  const touch = camera && "h-11 text-[14px]";
  // The file inputs are visually hidden, so the label shows the keyboard focus ring instead.
  const fileLabel = "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent";
  const hint = withExpiry
    ? "Drop files here. Add an expiry date to get a reminder 30 days before it lapses."
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
        {withExpiry && (
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="Expiry date" title="Expiry date (optional)"
            className={cn(inputClass, camera ? cn("w-full", touch) : "h-7 w-[9.5rem] text-[12px]")} />
        )}
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
