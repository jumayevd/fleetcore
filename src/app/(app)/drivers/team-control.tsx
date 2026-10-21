"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { setDriverTeam } from "@/app/actions/people";
import { cn } from "@/components/ui";
import { Popover, menuItemClass } from "./menu";
import type { TeamOption } from "./shared";

export function TeamDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: color ?? "var(--fg-faint)" }} />;
}

/**
 * Inline team assignment for a roster row. Reads as quiet text (dot + team name); for editors a
 * click opens a small menu of teams → setDriverTeam. No select box per row, so the roster stays calm.
 */
export function TeamControl({ driverId, teamId, teams, editable, size = "sm" }: {
  driverId: string; teamId: string | null; teams: TeamOption[]; editable: boolean; size?: "sm" | "md";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = teams.find((t) => t.id === teamId) ?? null;
  const label = (
    <span className={cn("inline-flex items-center gap-1.5", size === "md" ? "text-[13px]" : "text-[12px]", current ? "text-fg" : "text-fg-faint")}>
      <TeamDot color={current?.color} />{current?.name ?? "No team"}
    </span>
  );
  if (!editable) return label;

  const choose = (id: string | null, close: () => void) => start(async () => {
    setError(null);
    try { await setDriverTeam(driverId, id); close(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : "Could not change team"); }
  });

  return (
    <Popover width={200} align="start" trigger={({ open, toggle }) => (
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="Change team" disabled={pending}
        className={cn("group -ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1 transition-colors hover:bg-raised disabled:opacity-60", open && "bg-raised")}>
        {label}
        <ChevronDown className={cn("h-3 w-3 text-fg-faint transition-opacity group-hover:opacity-100", open ? "opacity-100" : "opacity-0")} />
      </button>
    )}>
      {(close) => (
        <div>
          <p className="px-2 pb-1 pt-1 text-[11px] text-fg-subtle">Dispatcher team</p>
          <ul role="menu" className="space-y-px">
            {teams.map((t) => (
              <li key={t.id} role="none">
                <button type="button" role="menuitem" disabled={pending} onClick={() => choose(t.id, close)} className={cn(menuItemClass, t.id === teamId && "bg-raised font-medium")}>
                  <TeamDot color={t.color} /><span className="flex-1">{t.name}</span>{t.id === teamId && <Check className="text-fg-subtle" />}
                </button>
              </li>
            ))}
            <li role="none">
              <button type="button" role="menuitem" disabled={pending} onClick={() => choose(null, close)} className={cn(menuItemClass, !teamId && "bg-raised font-medium")}>
                <TeamDot color={null} /><span className="flex-1 text-fg-muted">No team</span>{!teamId && <Check className="text-fg-subtle" />}
              </button>
            </li>
          </ul>
          {error && <p role="alert" className="mt-1 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
        </div>
      )}
    </Popover>
  );
}
