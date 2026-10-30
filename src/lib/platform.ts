import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { rootDb } from "@/lib/db-root";
import { getSessionContext } from "@/lib/session";

/*
 * Platform owners run FleetCore itself (User.platformRole = "OWNER", set by an operator only). They belong to no
 * company: the Platform console (/platform) lists every company and account, and they can open any company with an
 * owner's rights without being a member of it (src/lib/session.ts), so they never show in a company's member list.
 * What they do inside a company is in that company's audit log, under their name.
 */

export const PLATFORM_OWNER = "OWNER";

export const isPlatformOwner = (u: { platformRole?: string | null } | null | undefined) => u?.platformRole === PLATFORM_OWNER;

/** Who may create a company: platform owners, and the accounts they allow (User.canCreateCompanies). */
export const mayCreateCompanies = (u: { platformRole?: string | null; canCreateCompanies?: boolean } | null | undefined) =>
  isPlatformOwner(u) || Boolean(u?.canCreateCompanies);

/** The signed-in platform owner (the account working now if it is one, else any signed-in one). */
export async function requirePlatformOwner() {
  const ctx = await getSessionContext();
  if (!ctx.accounts.length) redirect("/login");
  const owners = await rootDb.user.findMany({
    where: { id: { in: ctx.accounts.map((a) => a.userId) }, active: true, platformRole: PLATFORM_OWNER },
    select: { id: true, name: true, email: true },
  });
  const me = owners.find((o) => o.id === ctx.active?.user.id) ?? owners[0];
  if (!me) redirect("/select");
  return me;
}

/* ------------------------------------------------------------------ */
/* One-time links to set a password                                    */
/* ------------------------------------------------------------------ */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new link for `userId` (older unused ones stop working). Returns the token: it is shown once, never stored. */
export async function createPasswordLink(userId: string, createdById: string | null, days = 3) {
  const token = randomBytes(24).toString("base64url");
  await rootDb.$transaction([
    rootDb.passwordLink.deleteMany({ where: { userId, usedAt: null } }),
    rootDb.passwordLink.create({ data: { userId, createdById, tokenHash: hash(token), expiresAt: new Date(Date.now() + days * 86_400_000) } }),
  ]);
  return token;
}

/** The link for `token` if it can still be used, with its account. */
export async function usablePasswordLink(token: string) {
  const link = await rootDb.passwordLink.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { id: true, name: true, email: true, active: true, platformRole: true } } },
  });
  return link && !link.usedAt && link.expiresAt > new Date() && link.user.active ? link : null;
}
