import "server-only";
import { rootDb } from "@/lib/db-root";

/*
 * Platform owners: the people who run FleetCore itself, named by account id in PLATFORM_OWNER_IDS (comma-separated;
 * ids, not emails, because nobody verifies an email at sign-up). Each is an owner of every company: added when a
 * company is created and, for companies made before, when they sign in. Nobody inside a company can change their
 * role or remove them. They show in each company's member list like any other owner, so everyone sees who has access.
 */

export function platformOwnerIds(): string[] {
  return (process.env.PLATFORM_OWNER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

export const isPlatformOwner = (userId: string | null | undefined) => !!userId && platformOwnerIds().includes(userId);

/** Owner seats for the platform owners in a company being created (the creator is seated already). */
export async function platformOwnerSeats(creatorId: string) {
  const ids = platformOwnerIds().filter((id) => id !== creatorId);
  if (!ids.length) return [];
  const users = await rootDb.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
  return users.map((u) => ({ userId: u.id, role: "OWNER" }));
}

/** A platform owner becomes (again) an owner of every company. Called on sign-in and sign-up. */
export async function ensurePlatformOwner(userId: string) {
  if (!isPlatformOwner(userId)) return;
  const [companies, seats] = await Promise.all([
    rootDb.company.findMany({ select: { id: true } }),
    rootDb.membership.findMany({ where: { userId }, select: { companyId: true, role: true, active: true } }),
  ]);
  const held = new Set(seats.map((s) => s.companyId));
  const missing = companies.filter((c) => !held.has(c.id)).map((c) => c.id);
  const lower = seats.filter((s) => s.role !== "OWNER" || !s.active).map((s) => s.companyId);
  if (!missing.length && !lower.length) return;
  await rootDb.$transaction([
    rootDb.membership.createMany({ data: missing.map((companyId) => ({ userId, companyId, role: "OWNER" })), skipDuplicates: true }),
    rootDb.membership.updateMany({ where: { userId, companyId: { in: lower } }, data: { role: "OWNER", active: true } }),
    rootDb.auditLog.createMany({
      data: [...missing, ...lower].map((companyId) => ({ companyId, userId, action: "join", entity: "member", entityId: userId, details: "Owner of every company as platform owner" })),
    }),
  ]);
}
