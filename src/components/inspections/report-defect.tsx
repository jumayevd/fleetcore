"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Container, Plus, Truck as TruckIcon } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/forms";
import { Button, Field, Select, Textarea, buttonClass, cn, type ButtonVariant } from "@/components/ui";
import { DEFECT_SEVERITIES } from "@/lib/constants";
import { DEFECT_COMPONENTS, SEVERITY_SHORT, componentLabel, severityLabel } from "@/lib/pti-shared";
import { reportDefect } from "@/app/actions/inspections";
import { Overlay } from "./overlay";

type UnitOpt = { id: string; label: string };
type Kind = "truck" | "trailer";

const SEVERITY_HINT: Record<string, string> = {
  NOW: "Takes the unit out of service until someone confirms the repair.",
  SOON: "Due in 14 days. The unit keeps running.",
  WATCH: "Keep an eye on it; due in 30 days.",
};

/**
 * "Report a defect": a button that opens the form in a drawer. On a unit page pass `fixed` (that unit only); on the
 * defects page pass the unit lists, and `startOpen` / `preset` when the URL asked for it (?new=1&truck=…).
 */
export function ReportDefect({ trucks = [], trailers = [], members = [], fixed, preset, startOpen, closeHref, variant = "primary", label = "Report a defect" }: {
  trucks?: UnitOpt[]; trailers?: UnitOpt[];
  members?: { id: string; name: string }[];
  fixed?: { type: Kind; id: string; label: string };
  preset?: { type: Kind; id: string };
  startOpen?: boolean;
  /** Where to go when the drawer closes (drops ?new=1 from the URL). */
  closeHref?: string;
  variant?: ButtonVariant;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(startOpen));
  const [kind, setKind] = useState<Kind>(fixed?.type ?? preset?.type ?? "truck");
  const [severity, setSeverity] = useState("SOON");
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };
  const list = kind === "truck" ? trucks : trailers;

  const toggle = (k: Kind) => (
    <button type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
        kind === k ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg")}>
      {k === "truck" ? <TruckIcon /> : <Container />}{k === "truck" ? "Truck" : "Trailer"}
    </button>
  );

  return (
    <>
      <span className="inline-flex items-center gap-2">
        {notice && <span role="status" className="max-w-96 truncate text-[12px] text-ok" title={notice}>{notice}</span>}
        <Button variant={variant} onClick={() => { setNotice(null); setOpen(true); }}><Plus />{label}</Button>
      </span>
      <Overlay open={open} onClose={close} title="Report a defect" subtitle={fixed ? `On ${fixed.label}` : "Something wrong with a truck or a trailer"}>
        <ActionForm action={reportDefect} className="space-y-4" onSuccess={(m) => { setNotice(m); close(); }}>
          <input type="hidden" name="unitType" value={kind} />
          {fixed ? (
            <input type="hidden" name={fixed.type === "truck" ? "truckId" : "trailerId"} value={fixed.id} />
          ) : (
            <div>
              <div className="mb-2 inline-flex rounded-[10px] bg-sunken p-[3px]">{toggle("truck")}{toggle("trailer")}</div>
              <Field label={kind === "truck" ? "Truck" : "Trailer"} required>
                <Select key={kind} name={kind === "truck" ? "truckId" : "trailerId"} required placeholder={`Pick a ${kind}…`}
                  defaultValue={preset?.type === kind ? preset.id : ""} options={list.map((u) => ({ value: u.id, label: u.label }))} />
              </Field>
              {list.length === 0 && <FormMessage tone="error" className="mt-2">No {kind}s in this company yet. Add one under Fleet first.</FormMessage>}
            </div>
          )}
          <Field label="Component" required>
            <Select name="component" required placeholder="Pick what is wrong…" defaultValue=""
              options={DEFECT_COMPONENTS.map((c) => ({ value: c, label: componentLabel(c) }))} />
          </Field>
          <div>
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">How soon<span className="text-danger"> *</span></span>
            <div role="radiogroup" aria-label="How soon" className="grid gap-1.5 sm:grid-cols-3">
              {DEFECT_SEVERITIES.map((s) => (
                <label key={s} className={cn("cursor-pointer rounded-md border px-2.5 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                  severity === s ? (s === "NOW" ? "border-danger/40 bg-danger-soft" : s === "SOON" ? "border-warn/40 bg-warn-soft" : "border-info/40 bg-info-soft") : "border-line hover:border-line-strong")}>
                  <input type="radio" name="severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} className="sr-only" />
                  <span className={cn("block text-[13px] font-medium", severity === s ? (s === "NOW" ? "text-danger" : s === "SOON" ? "text-warn" : "text-info") : "text-fg")}>{SEVERITY_SHORT[s]}</span>
                  <span className="block text-[11px] text-fg-subtle">{severityLabel(s)}</span>
                </label>
              ))}
            </div>
            <p className={cn("mt-1 text-[11px]", severity === "NOW" ? "text-danger" : "text-fg-subtle")}>{SEVERITY_HINT[severity]}</p>
          </div>
          <Field label="What is wrong" required>
            <Textarea name="description" required rows={3} placeholder="e.g. Left steer tire worn to the wear bars; driver reported a pull to the right" />
          </Field>
          {members.length > 0 && (
            <Field label="Owner" hint="Who makes sure it gets fixed. You can change it later.">
              <Select name="ownerId" placeholder="Nobody yet" defaultValue="" options={members.map((m) => ({ value: m.id, label: m.name }))} />
            </Field>
          )}
          <div className="flex items-center gap-2 pt-1">
            <SubmitButton>Report defect</SubmitButton>
            <button type="button" onClick={close} className={buttonClass("ghost")}>Cancel</button>
          </div>
        </ActionForm>
      </Overlay>
    </>
  );
}
