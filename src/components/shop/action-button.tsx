"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button, cn, type ButtonVariant } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/**
 * One-click button for a bound server action (`markDriverInformed.bind(null, id)`). Shows the refusal next to the button;
 * the page refreshes itself through the action's revalidation.
 */
export function ActionButton({ action, children, pendingText = "Saving…", confirm, variant = "secondary", size = "sm", className, title, showOk }: {
  action: () => Promise<ActionState>;
  children: ReactNode;
  pendingText?: string;
  confirm?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
  title?: string;
  /** Also show the success message (when the button stays on screen). */
  showOk?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = () => {
    if (confirm && !window.confirm(confirm)) return;
    start(async () => {
      setMsg(null);
      try {
        const res = await action();
        if (res?.error) setMsg({ tone: "error", text: res.error });
        else if (showOk && res?.ok) setMsg({ tone: "ok", text: res.ok });
      } catch {
        setMsg({ tone: "error", text: "That didn't go through. Refresh the page and try again." });
      }
    });
  };
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <Button variant={variant} size={size} disabled={pending} onClick={run} title={title}>{pending ? pendingText : children}</Button>
      {msg && <span role={msg.tone === "error" ? "alert" : "status"} className={cn("text-[11px]", msg.tone === "error" ? "text-danger" : "text-ok")}>{msg.text}</span>}
    </span>
  );
}
