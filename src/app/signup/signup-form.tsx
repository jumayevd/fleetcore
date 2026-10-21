"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signup } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { RegionPicker } from "@/components/region-picker";

export function SignupForm({ invite }: { invite: { token: string; email: string } | null }) {
  const [show, setShow] = useState(false);
  return (
    <ActionForm action={signup} className="mt-6 space-y-4">
      {invite && <input type="hidden" name="invite" value={invite.token} />}
      <Field label="Your name" required>
        <Input name="name" required autoComplete="name" placeholder="First and last name" autoFocus />
      </Field>
      <Field label="Email" required>
        <Input name="email" type="email" required autoComplete="email" placeholder="you@company.com" defaultValue={invite?.email} readOnly={Boolean(invite)} />
      </Field>
      <Field label="Password" required hint="At least 8 characters">
        <div className="relative">
          <Input name="password" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" className="pr-9" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-fg-subtle hover:text-fg">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      {!invite && (
        <Field label="Company you manage" required hint="The fleet's name as your team knows it. You can rename it later.">
          <Input name="company" required maxLength={80} placeholder="Blue Ridge Freight" autoComplete="organization" />
        </Field>
      )}
      {!invite && <RegionPicker />}
      <SubmitButton className="w-full" pendingText="Creating your workspace…">{invite ? "Create account and join" : "Create account"}</SubmitButton>
    </ActionForm>
  );
}
