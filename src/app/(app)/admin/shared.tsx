import type { Tone } from "@/components/ui";
import type { Role } from "@/lib/constants";

/**
 * Client-safe helpers shared by the administration pages (members, company, audit, account).
 * No Prisma or server-only imports here.
 */

/** Role → badge tone. Only privileged roles get colour; everyone else is graphite. */
export const ROLE_TONE: Record<Role, Tone> = {
  OWNER: "accent", ADMIN: "info", SPECIALIST: "neutral", VIEWER: "neutral",
};
