"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { acceptInvite, createCompany } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input, cardClass, cn } from "@/components/ui";
import { COMPANY_COLORS } from "@/lib/constants";
import { RegionPicker } from "@/components/region-picker";

/** "New company" tile: opens into a one-field form. The first company of an account starts open. */
export function NewCompanyForm({ userId, first }: { userId: string; first: boolean }) {
  const [open, setOpen] = useState(first);
  const [color, setColor] = useState<string>(COMPANY_COLORS[0]);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[13px] font-medium text-fg-muted transition-colors hover:border-accent/50 hover:bg-surface hover:text-fg">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sunken"><Plus className="h-4 w-4" /></span>
        New company
      </button>
    );
  }
  return (
    <ActionForm action={createCompany} className={cn(cardClass, "flex h-full flex-col gap-3 p-4")}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="color" value={color} />
      <label className="text-[13px] font-semibold text-fg" htmlFor={`new-company-${userId}`}>{first ? "Name your company" : "New company"}</label>
      <Input id={`new-company-${userId}`} name="name" required maxLength={80} placeholder="Company name" autoFocus={!first} />
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Badge colour">
        {COMPANY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
            className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-surface transition-shadow", color === c && "ring-2 ring-fg-muted")} style={{ background: c }} />
        ))}
      </div>
      <RegionPicker />
      <div className="mt-auto flex items-center gap-2">
        <SubmitButton pendingText="Creating…" className="flex-1">Create and open</SubmitButton>
        {!first && <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">Cancel</button>}
      </div>
    </ActionForm>
  );
}

export function AcceptInviteButton({ token, userId }: { token: string; userId: string }) {
  return (
    <ActionForm action={acceptInvite} className="shrink-0">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton size="sm" pendingText="Joining…">Join</SubmitButton>
    </ActionForm>
  );
}
