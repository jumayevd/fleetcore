"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button, Field, Input, Textarea, buttonClass, cn } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { disconnectMail } from "@/app/actions/mail";
import {
  MAIL_FILE_MAX_BYTES, MAIL_MAX_FILES, MAIL_PROVIDER_LABELS, MAIL_TOTAL_MAX_BYTES, type MailAttachment, type MailboxState, type MailProvider,
} from "@/lib/mail/shared";

/*
 * Write an email inside FleetCore and send it from the person's own Gmail or Outlook. First pick the mailbox (connect
 * it once if needed: that leaves for Google / Microsoft and comes back here), then write: to, subject, message and
 * attachments. Files upload as they are added; photos over 4 MB are shrunk first so they fit.
 */

type Upload = { id: string; name: string; size: number; status: "uploading" | "done" | "error"; error?: string; file?: MailAttachment };

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const splitAddresses = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** A photo too big to upload, redrawn smaller as JPEG until it fits (other files are left as they are). */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MAIL_FILE_MAX_BYTES || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  for (const [edge, quality] of [[2560, 0.85], [2048, 0.8], [1600, 0.75], [1280, 0.7]] as const) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= MAIL_FILE_MAX_BYTES) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  return file;
}

export function MailCompose({ open, onClose, to, vendorId, vendorName, mailboxes, returnTo, initialProvider, notice }: {
  open: boolean;
  onClose: () => void;
  to: string;
  vendorId: string;
  vendorName: string;
  mailboxes: MailboxState[];
  /** This page, to come back to after connecting a mailbox. */
  returnTo: string;
  /** Just connected (or picked): go straight to writing from it. */
  initialProvider?: MailProvider | null;
  /** How connecting went, when the page was reached from the provider. */
  notice?: { tone: "ok" | "error"; text: string } | null;
}) {
  const connected = (p: MailProvider | null | undefined) => mailboxes.find((m) => m.provider === p && m.email);
  const [provider, setProvider] = useState<MailProvider | null>(connected(initialProvider) ? initialProvider! : null);
  const [toText, setToText] = useState(to);
  const [ccText, setCcText] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const box = connected(provider);

  // Files still sitting in the outbox when the window closes without sending are deleted.
  const uploadsRef = useRef(uploads);
  useEffect(() => { uploadsRef.current = uploads; });
  const discard = () => {
    for (const u of uploadsRef.current) if (u.file) void fetch(`/api/mail/attachments?key=${encodeURIComponent(u.file.key)}`, { method: "DELETE" });
  };
  const close = () => {
    if (!sent) discard();
    setUploads([]); setSent(null); setError(null);
    onClose();
  };

  const total = uploads.reduce((s, u) => s + (u.file?.size ?? u.size), 0);
  async function addFiles(list: FileList | File[]) {
    setError(null);
    const files = [...list];
    if (uploads.length + files.length > MAIL_MAX_FILES) { setError(`Attach at most ${MAIL_MAX_FILES} files to one email.`); return; }
    for (const original of files) {
      const id = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { id, name: original.name, size: original.size, status: "uploading" }]);
      const file = await shrinkImage(original);
      const fail = (msg: string) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: "error", error: msg } : x)));
      if (file.size > MAIL_FILE_MAX_BYTES) { fail("Larger than 4 MB"); continue; }
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/mail/attachments", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) { fail(data.error ?? "Upload failed"); continue; }
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: "done", name: data.name, size: data.size, file: data } : x)));
      } catch {
        fail("Upload failed");
      }
    }
  }
  const remove = (u: Upload) => {
    if (u.file) void fetch(`/api/mail/attachments?key=${encodeURIComponent(u.file.key)}`, { method: "DELETE" });
    setUploads((list) => list.filter((x) => x.id !== u.id));
  };

  async function send() {
    if (!provider) return;
    setError(null);
    if (uploads.some((u) => u.status === "uploading")) { setError("Wait for the attachments to finish uploading."); return; }
    if (uploads.some((u) => u.status === "error")) { setError("Take off the attachments that didn't upload."); return; }
    if (total > MAIL_TOTAL_MAX_BYTES) { setError("The attachments add up to more than 18 MB. Send some in a second email."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, to: splitAddresses(toText), cc: showCc ? splitAddresses(ccText) : [], subject, text, vendorId,
          attachments: uploads.flatMap((u) => (u.file ? [{ key: u.file.key, name: u.file.name, type: u.file.type }] : [])),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Couldn't send it."); return; }
      setSent(`Sent to ${splitAddresses(toText).join(", ")} from ${data.from}.`);
      setUploads([]);
    } catch {
      setError("Couldn't reach FleetCore. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const connectHref = (p: MailProvider) =>
    `/api/mail/connect/${p.toLowerCase()}?returnTo=${encodeURIComponent(`${returnTo}${returnTo.includes("?") ? "&" : "?"}compose=${p.toLowerCase()}`)}`;

  const footer = sent ? (
    <div className="flex justify-end"><Button onClick={close}>Close</Button></div>
  ) : provider && box ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-fg-subtle">{uploads.length ? `${uploads.length} ${uploads.length === 1 ? "file" : "files"} · ${sizeText(total)}` : "Goes out from your own mailbox"}</span>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={sending} onClick={send}>{sending ? <Loader2 className="animate-spin" /> : <Send />}{sending ? "Sending…" : "Send"}</Button>
      </div>
    </div>
  ) : undefined;

  return (
    <Overlay open={open} onClose={close} wide title={sent ? "Email sent" : `Email ${vendorName}`}
      subtitle={sent ? undefined : provider && box ? `From ${box.email} (${MAIL_PROVIDER_LABELS[provider]})` : "Choose the mailbox to send from"} footer={footer}>
      {notice && !sent && <FormMessage tone={notice.tone} className="mb-3">{notice.text}</FormMessage>}

      {sent ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-ok" />
          <p className="text-[14px] font-medium text-fg">{sent}</p>
          <p className="text-[12px] text-fg-subtle">It is in the Sent folder of your {provider ? MAIL_PROVIDER_LABELS[provider] : "mailbox"}, and in the activity log.</p>
        </div>
      ) : !provider || !box ? (
        <div className="space-y-2">
          {mailboxes.map((m) => (
            <div key={m.provider} className="flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg">{MAIL_PROVIDER_LABELS[m.provider]}</p>
                <p className="truncate text-[11px] text-fg-subtle">
                  {!m.configured ? "Not set up on FleetCore yet: ask your FleetCore administrator" : m.email ? `Connected as ${m.email}` : "Not connected: you sign in once, and FleetCore can then send (never read) your mail"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {m.email && (
                  <Button variant="ghost" size="sm" disabled={pending}
                    onClick={() => start(async () => { const r = await disconnectMail(m.provider, returnTo.split("?")[0]); if (r?.error) setError(r.error); })}>
                    Disconnect
                  </Button>
                )}
                {m.configured && (m.email
                  ? <Button size="sm" onClick={() => { setError(null); setProvider(m.provider); }}>Use it</Button>
                  : <a href={connectHref(m.provider)} className={buttonClass("primary", "sm")}>Connect</a>)}
              </div>
            </div>
          ))}
          {error && <FormMessage tone="error">{error}</FormMessage>}
        </div>
      ) : (
        <div className="space-y-3"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
          <button type="button" onClick={() => setProvider(null)} className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" />Another mailbox
          </button>
          <Field label="To" required hint={showCc ? undefined : <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setShowCc(true)}>Add Cc</button>}>
            <Input value={toText} onChange={(e) => setToText(e.target.value)} placeholder="name@example.com" autoComplete="off" />
          </Field>
          {showCc && <Field label="Cc"><Input value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="Separate addresses with commas" autoComplete="off" /></Field>}
          <Field label="Subject" required><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} autoFocus /></Field>
          <Field label="Message"><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>

          <div className={cn("rounded-[9px] border border-dashed px-3 py-2.5 transition-colors", dragging ? "border-accent bg-accent-soft" : "border-line-strong")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-fg-muted">Photos, PDFs and other files · drop them here</span>
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><Paperclip />Attach files</Button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {uploads.length > 0 && (
              <ul className="mt-2 space-y-1">
                {uploads.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 rounded-md bg-raised px-2 py-1 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {u.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" /> : <Paperclip className={cn("h-3.5 w-3.5 shrink-0", u.status === "error" ? "text-danger" : "text-fg-subtle")} />}
                      <span className="truncate text-fg">{u.name}</span>
                      <span className={cn("shrink-0", u.status === "error" ? "text-danger" : "text-fg-subtle")}>{u.status === "error" ? u.error : sizeText(u.file?.size ?? u.size)}</span>
                    </span>
                    <button type="button" aria-label={`Remove ${u.name}`} onClick={() => remove(u)} className="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-sunken hover:text-fg"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && <FormMessage tone="error">{error}</FormMessage>}
        </div>
      )}
    </Overlay>
  );
}
