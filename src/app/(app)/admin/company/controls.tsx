"use client";

import { useState } from "react";
import { deleteCompany } from "@/app/actions/company";
import { ActionForm, SubmitButton } from "@/components/forms";
import { CompanyBadge } from "@/components/workspace-switcher";
import { Field, Input, cn } from "@/components/ui";
import { COMPANY_COLORS } from "@/lib/constants";

/** Badge colour swatches with a live preview of the company badge. Posts the hex as `name`. */
export function ColorPicker({ name, value, companyName }: { name: string; value: string | null; companyName: string }) {
  const [color, setColor] = useState<string>(value ?? COMPANY_COLORS[0]);
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={color} />
      <CompanyBadge name={companyName} color={color} size={32} />
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Badge colour">
        {COMPANY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
            className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow", color === c && "ring-2 ring-fg-muted")} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

/** Owners only: delete the company and everything in it, after typing its name. */
export function DeleteCompany({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-danger/30 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-fg">Delete this company</h2>
          <p className="text-[12px] text-fg-muted">Removes {name} with all its trucks, trailers, drivers, work orders and documents, for every member. This can&apos;t be undone.</p>
        </div>
        {!open && <button type="button" onClick={() => setOpen(true)} className="h-8 rounded-md border border-danger/40 px-3 text-[12px] font-medium text-danger hover:bg-danger-soft">Delete company…</button>}
      </div>
      {open && (
        <ActionForm action={deleteCompany} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={`Type ${name} to confirm`} className="min-w-64 flex-1"><Input name="confirm" required autoComplete="off" /></Field>
          <SubmitButton variant="danger" pendingText="Deleting…">Delete forever</SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-[12px] font-medium text-fg-muted hover:bg-raised">Cancel</button>
        </ActionForm>
      )}
    </section>
  );
}
