"use client";

import { startTransition, useActionState, useRef } from "react";
import { login } from "@/app/actions/auth";
import { Field, Input, buttonClass, cn } from "@/components/ui";
import { FormMessage } from "@/components/forms";

export function LoginForm({ demoAccounts }: { demoAccounts: { role: string; email: string }[] }) {
  const [state, action, pending] = useActionState(login, undefined);
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
        <Field label="Email">
          <Input ref={email} name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus />
        </Field>
        <Field label="Password">
          <Input ref={password} name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state?.error && <FormMessage tone="error">{state.error}</FormMessage>}
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={cn(buttonClass("primary"), "w-full")}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-[11px] text-fg-subtle">Forgot your password? Ask an administrator to reset it.</p>
      </form>

      {demoAccounts.length > 0 && (
        <div className="mt-6 rounded-lg bg-raised p-3 ring-1 ring-inset ring-line">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Demo mode</p>
            <span className="text-[11px] text-fg-subtle">Password <span className="num text-fg-muted">demo1234</span></span>
          </div>
          <p className="mt-1 text-[12px] text-fg-muted">Pick a role to sign in with sample data.</p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {demoAccounts.map((a) => (
              <button key={a.email} type="button" disabled={pending} className={cn(buttonClass("secondary", "sm"), "justify-start")}
                onClick={() => {
                  email.current!.value = a.email;
                  password.current!.value = "demo1234";
                  formRef.current!.requestSubmit();
                }}>
                {a.role}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
