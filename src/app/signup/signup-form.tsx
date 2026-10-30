"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signup } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { ProfileFields } from "@/components/profile-fields";

/** Create an account to accept an invitation (accounts are by invitation: new companies are set up by the platform owner). */
export function SignupForm({ invite }: { invite: { token: string; email: string } }) {
  const [show, setShow] = useState(false);
  return (
    <ActionForm action={signup} className="mt-6 space-y-4">
      <input type="hidden" name="invite" value={invite.token} />
      <ProfileFields autoFocus />
      <Field label="Email" required>
        <Input name="email" type="email" required autoComplete="email" defaultValue={invite.email} readOnly />
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
      <SubmitButton className="w-full" pendingText="Creating your account…">Create account and join</SubmitButton>
    </ActionForm>
  );
}
