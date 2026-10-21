"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/app/actions/auth";
import { Field, Input, buttonClass, cn } from "@/components/ui";
import { FormMessage } from "@/components/forms";

type Demo = { label: string; hint: string; email: string };

export function LoginForm({ demoAccounts, defaultEmail, invite, submitLabel }: {
  demoAccounts: Demo[]; defaultEmail?: string; invite?: string; submitLabel: string;
}) {
  const [state, action, pending] = useActionState(login, undefined);
  const [show, setShow] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      {/* method="post": a submit before hydration must never put the password in the URL. */}
      <form ref={formRef} method="post" className="mt-6 space-y-4" onSubmit={(e) => {
        // Manual submit keeps the email filled in if the password was wrong.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}>
        {invite && <input type="hidden" name="invite" value={invite} />}
        <Field label="Email">
          <Input ref={email} name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus={!defaultEmail}
            defaultValue={defaultEmail} readOnly={Boolean(invite && defaultEmail)} />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input ref={password} name="password" type={show ? "text" : "password"} autoComplete="current-password" required autoFocus={Boolean(defaultEmail)} className="pr-9" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-fg-subtle hover:text-fg">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {state?.error && <FormMessage tone="error">{state.error}</FormMessage>}
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(buttonClass("primary"), "w-full")}>
          {pending ? "Signing in…" : submitLabel}
        </button>
        <p className="text-[11px] text-fg-subtle">One account can work for several companies. Forgot your password? Ask your FleetOps administrator to reset it.</p>
      </form>

      {demoAccounts.length > 0 && !invite && (
        <div className="mt-6 rounded-lg bg-raised p-3 ring-1 ring-inset ring-line">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Demo mode</p>
            <span className="text-[11px] text-fg-subtle">Password <span className="num text-fg-muted">demo1234</span></span>
          </div>
          <p className="mt-1 text-[12px] text-fg-muted">Sign in with one, then add another from the company menu to try switching.</p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {demoAccounts.map((a) => (
              <button key={a.email} type="button" disabled={pending} title={a.hint} aria-label={`${a.label}: ${a.hint}`} className={cn(buttonClass("secondary", "sm"), "justify-start truncate")}
                onClick={() => {
                  email.current!.value = a.email;
                  password.current!.value = "demo1234";
                  formRef.current!.requestSubmit();
                }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
