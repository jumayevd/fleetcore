import type { Tone } from "@/components/ui";
import { cn } from "@/components/ui";
import type { Role } from "@/lib/constants";

/**
 * Client-safe helpers shared by the administration pages (users, company, audit, account).
 * No Prisma or server-only imports here.
 */

/** Role → badge tone. Only privileged roles get colour; everyone else is graphite. */
export const ROLE_TONE: Record<Role, Tone> = {
  OWNER: "accent", ADMIN: "info", DISPATCHER: "neutral", FLEET_MANAGER: "neutral", ACCOUNTANT: "neutral", DRIVER: "neutral",
};

/** Preset team colours (stored as data on Team.color, like the seed). Not UI palette classes. */
export const TEAM_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B"] as const;

export type TeamOption = { id: string; name: string; color: string | null };

/** Small coloured dot for a dispatcher team; grey when unassigned. */
export function TeamDot({ color, className, size = 8 }: { color: string | null | undefined; className?: string; size?: number }) {
  return (
    <span aria-hidden className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size, background: color ?? "var(--fg-faint)" }} />
  );
}

/** Dot + team name, quiet when there is no team. */
export function TeamLabel({ team, className }: { team: TeamOption | null | undefined; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", team ? "text-fg" : "text-fg-faint", className)}>
      <TeamDot color={team?.color} />{team?.name ?? "No team"}
    </span>
  );
}
