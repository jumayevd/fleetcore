"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { rootDb } from "@/lib/db-root";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { forgetSessions } from "@/lib/session";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { assignableRoles } from "@/lib/permissions";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { isPlatformOwner } from "@/lib/platform";

/*
 * Members of the active company. Memberships live outside the company scope (one person can belong to many
 * companies), so every query here names the company explicitly. Passwords belong to the person, not the company:
 * nobody here can see or reset them.
 */

const INVITE_DAYS = 14;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function ownerCount(companyId: string) {
  return rootDb.membership.count({ where: { companyId, role: "OWNER", active: true } });
}

export async function inviteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("members.manage");
  return attempt(async () => {
    const f = fields(fd);
    const email = f.req("email", "Email").toLowerCase();
    const role = f.req("role", "Role");
    if (!EMAIL.test(email)) throw new FormError("Enter a valid email address.");
    if (!isRole(role) || !assignableRoles(me.role).includes(role)) throw new FormError("You can't give that role.");
    const existing = await rootDb.membership.findFirst({ where: { companyId: me.company.id, user: { email }, active: true }, select: { id: true } });
    if (existing) throw new FormError(`${email} is already a member of ${me.company.name}.`);
    // One open invitation per email: a new one replaces the old link.
    await rootDb.invite.deleteMany({ where: { companyId: me.company.id, email, acceptedAt: null } });
    const invite = await rootDb.invite.create({
      data: {
        companyId: me.company.id, email, role, invitedById: me.id,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
    await audit(me.id, "invite", "member", invite.id, `${email} as ${ROLE_LABELS[role]}`);
    revalidatePath("/admin/members");
    return { ok: `Invitation for ${email} is ready. Use Copy link under Invitations and send it to them.` };
  });
}

export async function revokeInvite(inviteId: string) {
  const me = await requireUser("members.manage");
  const invite = await rootDb.invite.findFirst({ where: { id: inviteId, companyId: me.company.id, acceptedAt: null } });
  if (!invite) return;
  await rootDb.invite.delete({ where: { id: invite.id } });
  await audit(me.id, "revoke_invite", "member", invite.id, invite.email);
  revalidatePath("/admin/members");
}

export async function setMemberRole(membershipId: string, role: string): Promise<ActionState> {
  const me = await requireUser("members.manage");
  const res = await attempt(async () => {
    const m = await rootDb.membership.findFirst({ where: { id: membershipId, companyId: me.company.id }, include: { user: { select: { email: true } } } });
    if (!m) throw new FormError("This member is no longer in the company.");
    if (!isRole(role)) throw new FormError("Pick a valid role.");
    if (m.role === role) return { ok: "No change" };
    if (isPlatformOwner(m.userId)) throw new FormError(`${m.user.email} runs FleetCore and stays an owner of every company.`);
    if ((m.role === "OWNER" || role === "OWNER") && me.role !== "OWNER") throw new FormError("Only an owner can change owner roles.");
    if (!assignableRoles(me.role).includes(role)) throw new FormError("You can't give that role.");
    if (m.role === "OWNER" && (await ownerCount(me.company.id)) <= 1) throw new FormError("A company needs at least one owner. Make someone else an owner first.");
    await rootDb.membership.update({ where: { id: m.id }, data: { role } });
    forgetSessions();
    await audit(me.id, "role", "member", m.userId, `${m.user.email}: ${ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role} → ${ROLE_LABELS[role]}`);
    return { ok: `${m.user.email} is now ${ROLE_LABELS[role].toLowerCase()}` };
  });
  revalidatePath("/admin/members");
  return res;
}

export async function removeMember(membershipId: string): Promise<ActionState> {
  const me = await requireUser("members.manage");
  const res = await attempt(async () => {
    const m = await rootDb.membership.findFirst({ where: { id: membershipId, companyId: me.company.id }, include: { user: { select: { email: true } } } });
    if (!m) throw new FormError("This member is no longer in the company.");
    if (m.id === me.membershipId) throw new FormError("To leave the company yourself, use My account → Leave company.");
    if (isPlatformOwner(m.userId)) throw new FormError(`${m.user.email} runs FleetCore and keeps access to every company.`);
    if (m.role === "OWNER" && me.role !== "OWNER") throw new FormError("Only an owner can remove an owner.");
    if (m.role === "OWNER" && (await ownerCount(me.company.id)) <= 1) throw new FormError("A company needs at least one owner.");
    await rootDb.membership.delete({ where: { id: m.id } });
    forgetSessions();
    await audit(me.id, "remove", "member", m.userId, m.user.email);
    return { ok: `${m.user.email} no longer has access to ${me.company.name}` };
  });
  revalidatePath("/admin/members");
  return res;
}
