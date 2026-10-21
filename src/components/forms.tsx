"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn as clsx, buttonClass, type ButtonVariant } from "./ui";
import type { ActionState } from "@/lib/action";

const PendingContext = createContext(false);

export function SubmitButton({ children, variant = "primary", size, className, pendingText, disabled }: {
  children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; className?: string; pendingText?: string; disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} className={clsx(buttonClass(variant, size), className)}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

/** Inline outcome message in tokens: ok (green wash) or error (red wash). */
export function FormMessage({ tone, children, className }: { tone: "ok" | "error"; children: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <p role={tone === "ok" ? "status" : "alert"}
      className={clsx("flex items-start gap-2 rounded-md px-3 py-2 text-[12px] leading-4", tone === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger", className)}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Form bound to a server action returning ActionState; shows errors/success inline.
 * Submits via startTransition instead of <form action> so React doesn't auto-reset
 * the fields — a validation error must not wipe what the user typed.
 */
export function ActionForm({ action, children, className, resetOnSuccess, confirm, onSuccess, ...rest }: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** window.confirm() text shown before submitting (destructive actions). */
  confirm?: string;
  /** Called once per successful submit (close a drawer, clear a selection). */
  onSuccess?: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; });
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    onSuccessRef.current?.(state.ok);
  }, [state, resetOnSuccess]);
  return (
    <form
      // A submit before hydration falls back to a native POST, so field values never land in the URL.
      method="post"
      {...rest}
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state?.error && <FormMessage tone="error" className="mt-3">{state.error}</FormMessage>}
      {state?.ok && !pending && <FormMessage tone="ok" className="mt-3">{state.ok}</FormMessage>}
    </form>
  );
}
