"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/**
 * "Delete" for a record's page: asks first (window.confirm with `confirm`), runs the bound server action, then goes to
 * `redirectTo` (the list), since the page it was on no longer exists. A refusal shows next to the button.
 */
export function DeleteButton({ action, confirm, redirectTo, label = "Delete", size = "md", className }: {
  action: () => Promise<ActionState>;
  confirm: string;
  redirectTo: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (!window.confirm(confirm)) return;
    start(async () => {
      setError(null);
      const res = await action().catch(() => ({ error: "That didn't go through. Refresh the page and try again." }));
      if (res?.error) setError(res.error);
      else router.replace(redirectTo);
    });
  };
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {/* Quiet until hovered: red text, not a red block, next to Edit. */}
      <Button variant="ghost" size={size} disabled={pending} onClick={run} className="text-danger hover:bg-danger-soft hover:text-danger">
        <Trash2 />{pending ? "Deleting…" : label}
      </Button>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
