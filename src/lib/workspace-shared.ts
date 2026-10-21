import type { Role } from "./constants";

/*
 * Client-safe shapes for accounts and companies (the workspace switcher, the chooser and the tab guard).
 * No Prisma or server-only imports here.
 */

/** Name of the cookie that says which signed-in account and company this browser is working in ("<userId>.<companyId>"). */
export const ACTIVE_COOKIE = "fo_active";
/** Same-origin channel: a tab that switches company tells the others, so a stale tab never edits the wrong company. */
export const WORKSPACE_CHANNEL = "fleetcore-workspace";

export type WorkspaceCompany = { id: string; name: string; color: string | null; role: Role };
/** One signed-in account and the companies it can open. */
export type WorkspaceAccount = { userId: string; name: string; email: string; companies: WorkspaceCompany[] };
export type ActiveWorkspace = { userId: string; companyId: string; companyName: string; color: string | null; role: Role; email: string };

export const workspaceKey = (userId: string, companyId: string) => `${userId}.${companyId}`;

export function parseWorkspaceKey(v: string | null | undefined): { userId: string; companyId: string } | null {
  if (!v) return null;
  const [userId, companyId, extra] = decodeURIComponent(v).split(".");
  if (!userId || !companyId || extra !== undefined || !/^[a-z0-9]+$/i.test(userId) || !/^[a-z0-9]+$/i.test(companyId)) return null;
  return { userId, companyId };
}

/** Up to two initials for a company badge: "Silk Road Freight" → "SR". */
export function companyInitials(name: string) {
  const words = name.replace(/[«»"'().,]/g, " ").split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0][0], words[1][0]] : [...(words[0] ?? "?").slice(0, 2)]).join("");
  return letters.toUpperCase();
}

/** Readable text colour on a company badge. */
export function badgeText(hex: string | null | undefined) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#111827" : "#ffffff";
}
