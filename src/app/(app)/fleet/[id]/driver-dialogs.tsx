"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Camera, Check, ChevronDown, ImageIcon, Pencil, Plus, Search, UserMinus, UserPlus, X } from "lucide-react";
import { Button, Field, IconButton, Textarea, buttonClass, cn, inputClass } from "@/components/ui";
import { FormMessage } from "@/components/forms";
import { Overlay } from "@/components/inspections/overlay";
import { DeleteDocumentButton } from "@/components/documents/delete-button";
import { sendFiles, type UploadStatus } from "@/components/documents/uploader";
import { HANDOVER_ITEMS, HANDOVER_LABELS, type HandoverItem } from "@/lib/handover";
import { changeTruckDriver, unassignTruckDriver, updateAssignment, type AssignResult } from "@/app/actions/assignments";

/** A driver the truck can be given. `truck`: the unit they drive now, if any (they move over from it). */
export type DriverOption = { id: string; name: string; status: string; hold: boolean; truck: string | null };

/** One stint, as the dialogs edit it. Days are yyyy-mm-dd in company time. */
export type StintView = {
  id: string; driverName: string; startedAt: string; endedAt: string | null;
  handover: HandoverItem[]; note: string | null; endNote: string | null; photos: { id: string; name: string }[];
};

type Mode = "change" | "unassign" | "edit";

/** The Assigned driver card's buttons: Assign (no driver), or Edit · Change · Unassign. */
export function DriverActions({ truckId, unit, today, current, drivers, path }: {
  truckId: string; unit: string; today: string; current: StintView | null; drivers: DriverOption[]; path: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (msg?: string) => { setMode(null); if (msg) setNotice(msg); };
  const open = (m: Mode) => { setNotice(null); setMode(m); };
  // On a phone the three buttons show their icons only, so the card header never runs off the screen.
  const label = (text: string) => <span className="hidden sm:inline">{text}</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {notice && <span role="status" className="hidden max-w-72 truncate text-[12px] text-ok lg:inline" title={notice}>{notice}</span>}
      {current ? (
        <>
          <Button size="sm" variant="secondary" onClick={() => open("edit")} aria-label="Edit" title="Edit the date, the handover and the note"><Pencil />{label("Edit")}</Button>
          <Button size="sm" variant="secondary" onClick={() => open("change")} aria-label="Change driver" title="Give the truck to another driver"><ArrowLeftRight />{label("Change")}</Button>
          <Button size="sm" variant="secondary" onClick={() => open("unassign")} aria-label="Unassign" title="Take the driver off the truck"><UserMinus />{label("Unassign")}</Button>
        </>
      ) : (
        <Button size="sm" onClick={() => open("change")}><UserPlus />Assign driver</Button>
      )}
      {mode === "change" && <ChangeDriver truckId={truckId} unit={unit} today={today} drivers={drivers} first={!current} onDone={done} />}
      {mode === "unassign" && current && <Unassign truckId={truckId} unit={unit} today={today} current={current} onDone={done} />}
      {mode === "edit" && current && <EditStint unit={unit} today={today} stint={current} path={path} onDone={done} />}
    </span>
  );
}

/** Pencil on a history row: correct an earlier stint. */
export function EditStintButton({ unit, today, stint, path }: { unit: string; today: string; stint: StintView; path: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={`Edit ${stint.driverName}'s stint`} onClick={() => setOpen(true)}><Pencil /></IconButton>
      {open && <EditStint unit={unit} today={today} stint={stint} path={path} onDone={() => setOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

/** Save, then upload the picked photos to the stint the action returns. */
function useSubmit(save: (fd: FormData) => Promise<AssignResult>, picked: Picked[], onDone: (msg?: string) => void) {
  const photos = picked.map((p) => p.file);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let res: AssignResult;
    try {
      res = await save(new FormData(e.currentTarget));
    } catch {
      setBusy(false);
      setError("Couldn't save. Check your connection and try again.");
      return;
    }
    if (res.error) { setBusy(false); setError(res.error); return; }
    let failed = false;
    if (photos.length && res.assignmentId) {
      const sent = await sendFiles(photos, { type: "assignment", id: res.assignmentId }, "PHOTO", {}, setStatus);
      failed = sent < photos.length;
    }
    router.refresh();
    setBusy(false);
    // Saved either way; a photo that didn't upload stays visible here so the person can add it again with Edit.
    if (!failed) onDone(res.ok);
    else setError(`${res.ok ?? "Saved."} Some photos didn't upload; add them again with Edit.`);
  };
  return { busy, error, status, submit };
}

function ChangeDriver({ truckId, unit, today, drivers, first, onDone }: {
  truckId: string; unit: string; today: string; drivers: DriverOption[]; first: boolean; onDone: (msg?: string) => void;
}) {
  const formId = useId();
  const [driverId, setDriverId] = useState("");
  const [photos, setPhotos] = usePicked();
  const { busy, error, status, submit } = useSubmit((fd) => changeTruckDriver(truckId, fd), photos, onDone);
  const picked = drivers.find((d) => d.id === driverId);
  return (
    <Overlay onClose={() => onDone()} title={first ? "Assign driver" : "Change driver"}
      subtitle={`Unit ${unit}. The driver, the date, what goes with the unit and the photos stay on the record.`}
      footer={<Footer formId={formId} busy={busy} label={first ? "Assign driver" : "Change driver"} disabled={!driverId} onCancel={() => onDone()} />}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field label="New driver" required hint={picked?.truck ? `${picked.name} drives ${picked.truck} now; that truck will have no driver.` : "From the Drivers page. Search by name."}>
          <DriverPicker drivers={drivers} value={driverId} onChange={setDriverId} />
        </Field>
        <Field label="Assigned date" required hint="The day the driver took the unit.">
          <input type="date" name="startedAt" required defaultValue={today} max={today} className={inputClass} />
        </Field>
        <Handover initial={[]} />
        <Photos items={photos} onChange={setPhotos} hint="The unit as the driver took it: outside, cab, dash, damage." />
        <Field label="Note"><Textarea name="note" rows={3} maxLength={1000} placeholder="Anything the next person should know about this handover" /></Field>
        <Outcome error={error} status={status} />
      </form>
    </Overlay>
  );
}

function Unassign({ truckId, unit, today, current, onDone }: { truckId: string; unit: string; today: string; current: StintView; onDone: (msg?: string) => void }) {
  const formId = useId();
  const { busy, error, status, submit } = useSubmit((fd) => unassignTruckDriver(truckId, fd), [], onDone);
  return (
    <Overlay variant="dialog" onClose={() => onDone()} title={`Take ${current.driverName} off ${unit}`} subtitle="Their stint goes into the truck's driver history."
      footer={<Footer formId={formId} busy={busy} label="Unassign" onCancel={() => onDone()} />}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field label="Last day" required hint="The day the driver gave the unit back.">
          <input type="date" name="endedAt" required defaultValue={today} min={current.startedAt} max={today} className={inputClass} />
        </Field>
        <Field label="Returned with the unit"><Textarea name="endNote" rows={3} maxLength={1000} placeholder="Keys, fuel card and tablet back; scratch on the right mirror" /></Field>
        <Outcome error={error} status={status} />
      </form>
    </Overlay>
  );
}

function EditStint({ unit, today, stint, path, onDone }: { unit: string; today: string; stint: StintView; path: string; onDone: (msg?: string) => void }) {
  const formId = useId();
  const [photos, setPhotos] = usePicked();
  const { busy, error, status, submit } = useSubmit((fd) => updateAssignment(stint.id, fd), photos, onDone);
  return (
    <Overlay onClose={() => onDone()} title={`${stint.driverName} on ${unit}`} subtitle={stint.endedAt ? "An earlier stint. Correct its days, the handover and the notes." : "The current stint. Correct the date, the handover and the note."}
      footer={<Footer formId={formId} busy={busy} label="Save" onCancel={() => onDone()} />}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assigned date" required>
            <input type="date" name="startedAt" required defaultValue={stint.startedAt} max={stint.endedAt ?? today} className={inputClass} />
          </Field>
          {stint.endedAt && (
            <Field label="Last day" required>
              <input type="date" name="endedAt" required defaultValue={stint.endedAt} min={stint.startedAt} max={today} className={inputClass} />
            </Field>
          )}
        </div>
        <Handover initial={stint.handover} />
        {stint.photos.length > 0 && (
          <div>
            <p className="mb-1 text-[12px] font-medium text-fg-muted">Pickup photos on file</p>
            <ul className="space-y-1">
              {stint.photos.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1">
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  <a href={`/api/documents/${p.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] text-fg hover:underline">{p.name}</a>
                  <DeleteDocumentButton id={p.id} name={p.name} path={path} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <Photos items={photos} onChange={setPhotos} label={stint.photos.length ? "Add more photos" : "Pickup photos"} />
        <Field label="Note"><Textarea name="note" rows={3} maxLength={1000} defaultValue={stint.note ?? ""} /></Field>
        {stint.endedAt && <Field label="Returned with the unit"><Textarea name="endNote" rows={2} maxLength={1000} defaultValue={stint.endNote ?? ""} /></Field>}
        <Outcome error={error} status={status} />
      </form>
    </Overlay>
  );
}

function Footer({ formId, busy, label, disabled, onCancel }: { formId: string; busy: boolean; label: string; disabled?: boolean; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <button type="submit" form={formId} disabled={busy || disabled} aria-busy={busy || undefined} className={buttonClass("primary")}>{busy ? "Saving…" : label}</button>
    </div>
  );
}

function Outcome({ error, status }: { error: string | null; status: UploadStatus | null }) {
  if (error) return <FormMessage tone="error">{error}</FormMessage>;
  if (status?.tone === "busy") return <p role="status" className="text-[12px] text-fg-subtle">{status.text}</p>;
  return null;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Search the company's drivers and pick one. Submits `driverId`. */
function DriverPicker({ drivers, value, onChange }: { drivers: DriverOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 60);
  }, [drivers, query]);
  const current = drivers.find((d) => d.id === value);
  const choose = (id: string) => { onChange(id); setOpen(false); setQuery(""); };
  // Enter inside the picker picks the only match and never submits the form around it.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (matches.length === 1) choose(matches[0].id); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  const tag = (d: DriverOption) => d.truck ? `drives ${d.truck}` : d.hold ? "on hold" : d.status === "ON_LEAVE" ? "on leave" : "no truck";
  return (
    <div ref={ref} className="relative">
      <input type="hidden" name="driverId" value={value} />
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(inputClass, "flex items-center gap-2 text-left")}>
        <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-fg-faint")}>{current ? current.name : "Search drivers…"}</span>
        {current && <span className="shrink-0 text-[11px] text-fg-subtle">{tag(current)}</span>}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
      </button>
      {open && (
        <div className="pop-in absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-line bg-overlay shadow-float">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Driver name"
              aria-label="Search drivers" className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus:outline-none" />
          </div>
          <ul role="listbox" aria-label="Drivers" className="max-h-64 overflow-auto py-1">
            {matches.map((d) => (
              <li key={d.id}>
                <button type="button" role="option" aria-selected={d.id === value} onClick={() => choose(d.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-raised">
                  <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
                  <span className={cn("shrink-0 text-[11px]", d.hold || d.status === "ON_LEAVE" ? "text-warn" : "text-fg-subtle")}>{tag(d)}</span>
                  {d.id === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-2 text-[12px] text-fg-muted">{drivers.length ? "No driver matches." : "No active drivers. Add one on the Drivers page."}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What went with the unit: the standard items with an optional serial or tag number, plus anything else. */
function Handover({ initial }: { initial: HandoverItem[] }) {
  const id = useId();
  const [std, setStd] = useState<Record<string, { on: boolean; ref: string }>>(() =>
    Object.fromEntries(HANDOVER_ITEMS.map((k) => {
      const h = initial.find((x) => x.item === k);
      return [k, { on: Boolean(h), ref: h?.ref ?? "" }];
    })));
  const [others, setOthers] = useState(() => initial.filter((x) => x.item === "OTHER").map((x) => ({ label: x.label ?? "", ref: x.ref ?? "" })));
  const [draft, setDraft] = useState("");
  const value: HandoverItem[] = [
    ...HANDOVER_ITEMS.filter((k) => std[k].on).map((k) => ({ item: k, ref: std[k].ref.trim() || undefined })),
    ...others.filter((o) => o.label.trim()).map((o) => ({ item: "OTHER" as const, label: o.label.trim(), ref: o.ref.trim() || undefined })),
  ];
  const add = () => {
    const label = draft.trim();
    if (!label) return;
    setOthers((o) => (o.some((x) => x.label.toLowerCase() === label.toLowerCase()) ? o : [...o, { label, ref: "" }]));
    setDraft("");
  };
  const refInput = "h-8 min-w-0 flex-1 text-[12px]";
  return (
    <fieldset>
      <legend className="mb-1 text-[12px] font-medium text-fg-muted">Handed over with the unit</legend>
      <input type="hidden" name="handover" value={JSON.stringify(value)} />
      <div className="space-y-1.5 rounded-md border border-line p-2.5">
        {HANDOVER_ITEMS.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2 text-[13px] text-fg">
              <input type="checkbox" checked={std[k].on} onChange={(e) => setStd((s) => ({ ...s, [k]: { ...s[k], on: e.target.checked } }))}
                className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]" />
              {HANDOVER_LABELS[k]}
            </label>
            <input value={std[k].ref} aria-label={`${HANDOVER_LABELS[k]}: serial, model or tag number`} placeholder="Serial, model or tag number (optional)" maxLength={80}
              onChange={(e) => { const ref = e.target.value; setStd((s) => ({ ...s, [k]: { on: s[k].on || ref.trim() !== "", ref } })); }}
              className={cn(inputClass, refInput)} />
          </div>
        ))}
        {others.map((o, i) => (
          <div key={`${o.label}-${i}`} className="flex items-center gap-2">
            <span className="flex w-28 shrink-0 items-center gap-2 truncate text-[13px] text-fg" title={o.label}><Check className="h-4 w-4 shrink-0 text-accent-text" />{o.label}</span>
            <input value={o.ref} aria-label={`${o.label}: serial, model or tag number`} placeholder="Serial, model or tag number (optional)" maxLength={80}
              onChange={(e) => setOthers((all) => all.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))} className={cn(inputClass, refInput)} />
            <IconButton label={`Remove ${o.label}`} onClick={() => setOthers((all) => all.filter((_, j) => j !== i))}><X /></IconButton>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <input id={`${id}-other`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Something else handed over…" aria-label="Something else handed over" className={cn(inputClass, refInput)} />
          <Button size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}><Plus />Add</Button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-fg-subtle">Tick what the driver received; add a serial or tag number where it helps.</p>
    </fieldset>
  );
}

/** A picked photo and its local preview. */
type Picked = { file: File; url: string };

/** Picked photos; their previews are released when removed or when the dialog closes. */
function usePicked() {
  const [items, setItems] = useState<Picked[]>([]);
  const live = useRef(items);
  useEffect(() => { live.current = items; });
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  return [items, setItems] as const;
}

/** Pick photos (camera or library, or drop them). They upload after the form saves. */
function Photos({ items, onChange, label = "Pickup photos", hint }: { items: Picked[]; onChange: (p: Picked[]) => void; label?: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const addFiles = (list: FileList | null) => {
    const room = 12 - items.length;
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)).slice(0, Math.max(0, room));
    if (picked.length) onChange([...items, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (input.current) input.current.value = "";
  };
  const remove = (i: number) => {
    URL.revokeObjectURL(items[i].url);
    onChange(items.filter((_, j) => j !== i));
  };
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-fg-muted">{label}</p>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-raised/60")}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-text"><Camera className="h-4 w-4" /></span>
        <span className="text-[13px] font-medium text-fg">Add photos</span>
        <span className="text-[11px] text-fg-subtle">Take a photo or choose from your library, or drop them here</span>
        <input ref={input} type="file" accept="image/*,.heic" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
      </label>
      <p className="mt-1 text-[11px] text-fg-subtle">JPEG, PNG, WebP or HEIC. Big photos are shrunk before upload; up to 12.{hint ? ` ${hint}` : ""}</p>
      {items.length > 0 && (
        <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {items.map((p, i) => (
            <li key={p.url} className="relative aspect-square overflow-hidden rounded-md border border-line bg-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL), not a served image */}
              <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-scrim px-1 text-[10px] text-white">{p.file.name}</span>
              <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => remove(i)}
                className="absolute right-0.5 top-0.5 rounded-full bg-overlay p-0.5 text-fg-muted shadow-card hover:text-danger"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
