"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rootDb } from "@/lib/db-root";
import { requireUser } from "@/lib/auth";
import { addAccount, currentAccounts, forgetSessions, getSessionContext, writeAccounts, writeActive } from "@/lib/session";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { COMPANY_COLORS, isRole } from "@/lib/constants";
import { landingAfterSwitch } from "@/lib/nav";
import { HOME } from "@/lib/permissions";

// bcrypt hash of a random string; only used to equalise timing for unknown emails.
const DUMMY_HASH = "$2b$10$Dfob35lSw0BVw8zEqfQSY.8DFhc6CSl6DeU4B3W3T1BW03c0vUecO";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Work in `companyId` as `userId` from now on (this browser). */
async function activate(userId: string, companyId: string) {
  await writeActive(userId, companyId);
  await rootDb.membership.update({ where: { userId_companyId: { userId, companyId } }, data: { lastActiveAt: new Date() } });
}

async function signedIn(userId: string) {
  return (await currentAccounts()).some((a) => a.userId === userId);
}

const pickColor = () => COMPANY_COLORS[Math.floor(Math.random() * COMPANY_COLORS.length)];

/** A usable invite for `email`, or a FormError saying why not. */
async function usableInvite(token: string, email?: string) {
  const invite = await rootDb.invite.findUnique({ where: { token }, include: { company: { select: { id: true, name: true } } } });
  if (!invite || invite.acceptedAt) throw new FormError("This invitation has already been used or was withdrawn.");
  if (invite.expiresAt < new Date()) throw new FormError("This invitation has expired. Ask for a new link.");
  if (email && invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new FormError(`This invitation is for ${invite.email}. Sign in or create an account with that email to accept it.`);
  }
  return invite;
}

/** Join the invite's company (or re-activate an old membership) and mark the invite used. */
async function joinWithInvite(userId: string, invite: { id: string; companyId: string; role: string }) {
  const role = isRole(invite.role) ? invite.role : "SPECIALIST";
  await rootDb.$transaction([
    rootDb.membership.upsert({
      where: { userId_companyId: { userId, companyId: invite.companyId } },
      update: { active: true, role },
      create: { userId, companyId: invite.companyId, role },
    }),
    rootDb.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    rootDb.auditLog.create({ data: { companyId: invite.companyId, userId, action: "join", entity: "member", entityId: userId, details: `Joined as ${role} by invitation` } }),
  ]);
  forgetSessions();
}

/* ------------------------------------------------------------------ */
/* Sign in · add another account · sign up                             */
/* ------------------------------------------------------------------ */

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const inviteToken = String(fd.get("invite") ?? "").trim();
  const user = await rootDb.user.findUnique({ where: { email } });
  // Always run one bcrypt compare so response time doesn't reveal which emails are registered.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) return { error: "That email and password don't match an account." };

  let invite: Awaited<ReturnType<typeof usableInvite>> | null = null;
  if (inviteToken) {
    try {
      invite = await usableInvite(inviteToken, user.email);
    } catch (e) {
      if (e instanceof FormError) return { error: e.message };
      throw e;
    }
  }

  await addAccount(user.id);
  await rootDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  if (invite) await joinWithInvite(user.id, invite);

  const memberships = await rootDb.membership.findMany({
    where: { userId: user.id, active: true },
    orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    select: { companyId: true },
  });
  // Straight in when there is only one place to go (or the invite says where); otherwise let them choose.
  const target = invite?.companyId ?? (memberships.length === 1 ? memberships[0].companyId : null);
  await rootDb.auditLog.create({ data: { companyId: target, userId: user.id, action: "login", entity: "user", entityId: user.id } });
  if (target) {
    await activate(user.id, target);
    redirect(HOME);
  }
  redirect(`/select?account=${user.id}`);
}

export async function signup(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest = HOME;
  const res = await attempt(async () => {
    const f = fields(fd);
    const name = f.req("name", "Your name");
    const email = f.req("email", "Email").toLowerCase();
    const password = f.req("password", "Password");
    const inviteToken = f.str("invite");
    if (!EMAIL.test(email)) throw new FormError("Enter a valid email address.");
    if (password.length < 8) throw new FormError("Use at least 8 characters for the password.");
    const invite = inviteToken ? await usableInvite(inviteToken, email) : null;
    const companyName = invite ? null : f.req("company", "Company name");
    if (await rootDb.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new FormError("An account with this email already exists. Sign in instead — you can add more companies to it.");
    }

    const user = await rootDb.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 10), lastLoginAt: new Date() } });
    let companyId: string;
    if (invite) {
      await joinWithInvite(user.id, invite);
      companyId = invite.companyId;
    } else {
      const company = await rootDb.company.create({
        data: { name: companyName!, color: pickColor(), memberships: { create: { userId: user.id, role: "OWNER" } } },
      });
      companyId = company.id;
      await rootDb.auditLog.create({ data: { companyId, userId: user.id, action: "create", entity: "company", entityId: companyId, details: company.name } });
      dest = `${HOME}?welcome=1`;
    }
    await addAccount(user.id);
    await activate(user.id, companyId);
  });
  if (res?.error) return res;
  redirect(dest);
}

/* ------------------------------------------------------------------ */
/* Switching, creating and leaving companies                           */
/* ------------------------------------------------------------------ */

/** Switch this browser to another company of a signed-in account. Lands on the same list page (Trucks stays Trucks). */
export async function switchCompany(fd: FormData) {
  const userId = String(fd.get("userId") ?? "");
  const companyId = String(fd.get("companyId") ?? "");
  const path = String(fd.get("path") ?? "");
  if (!(await signedIn(userId))) redirect("/login?add=1");
  const m = await rootDb.membership.findUnique({ where: { userId_companyId: { userId, companyId } }, select: { active: true } });
  if (!m?.active) redirect("/select");
  await activate(userId, companyId);
  redirect(landingAfterSwitch(path));
}

/** New company for a signed-in account (the active one unless the form names another). The creator becomes its owner. */
export async function createCompany(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await attempt(async () => {
    const f = fields(fd);
    const name = f.req("name", "Company name");
    if (name.length > 80) throw new FormError("Keep the company name under 80 characters.");
    const ctx = await getSessionContext();
    const userId = f.str("userId") ?? ctx.active?.user.id ?? ctx.accounts[0]?.userId;
    if (!userId || !(await signedIn(userId))) throw new FormError("Sign in first.");
    const company = await rootDb.company.create({
      data: { name, color: f.str("color") ?? pickColor(), memberships: { create: { userId, role: "OWNER" } } },
    });
    await rootDb.auditLog.create({ data: { companyId: company.id, userId, action: "create", entity: "company", entityId: company.id, details: name } });
    await activate(userId, company.id);
  });
  if (res?.error) return res;
  redirect(`${HOME}?welcome=1`);
}

/** Join a company with an invitation, as one of the signed-in accounts. */
export async function acceptInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await attempt(async () => {
    const token = String(fd.get("token") ?? "");
    const userId = String(fd.get("userId") ?? "");
    if (!(await signedIn(userId))) throw new FormError("Sign in with the invited email first.");
    const user = await rootDb.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const invite = await usableInvite(token, user.email);
    await joinWithInvite(userId, invite);
    await activate(userId, invite.companyId);
  });
  if (res?.error) return res;
  redirect(HOME);
}

/** Leave the active company. The last owner has to hand over (or delete the company) first. */
export async function leaveCompany(): Promise<ActionState> {
  const me = await requireUser();
  const res = await attempt(async () => {
    if (me.role === "OWNER") {
      const owners = await rootDb.membership.count({ where: { companyId: me.company.id, role: "OWNER", active: true } });
      if (owners <= 1) throw new FormError("You are the only owner. Make another member an owner first, or delete the company.");
    }
    await rootDb.membership.delete({ where: { id: me.membershipId } });
    await rootDb.auditLog.create({ data: { companyId: me.company.id, userId: me.id, action: "leave", entity: "member", entityId: me.id, details: me.email } });
    await writeActive(me.id, null);
  });
  if (res?.error) return res;
  redirect("/select");
}

/* ------------------------------------------------------------------ */
/* Signing out                                                         */
/* ------------------------------------------------------------------ */

/** Sign one account out of this browser. Work carries on in another signed-in account if there is one. */
export async function signOut(fd: FormData) {
  const ctx = await getSessionContext();
  const userId = String(fd.get("userId") ?? "") || ctx.active?.user.id;
  const rest = ctx.accounts.filter((a) => a.userId !== userId);
  await writeAccounts(rest);
  if (!rest.length) redirect("/login");
  if (ctx.active && ctx.active.user.id !== userId) {
    // The active company belongs to another account: nothing changes for it.
    revalidatePath("/", "layout");
    redirect(landingAfterSwitch(String(fd.get("path") ?? "")));
  }
  const next = await rootDb.membership.findFirst({
    where: { userId: { in: rest.map((a) => a.userId) }, active: true, user: { active: true } },
    orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }],
    select: { userId: true, companyId: true },
  });
  if (!next) {
    await writeActive(rest[0].userId, null);
    redirect("/select");
  }
  await activate(next.userId, next.companyId);
  redirect(HOME);
}

export async function signOutAll() {
  await writeAccounts([]);
  redirect("/login");
}

/* ------------------------------------------------------------------ */
/* My account                                                          */
/* ------------------------------------------------------------------ */

export async function updateProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  return attempt(async () => {
    const f = fields(fd);
    await rootDb.user.update({ where: { id: me.id }, data: { name: f.req("name", "Name"), phone: f.str("phone") } });
    forgetSessions();
    revalidatePath("/", "layout");
    return { ok: "Profile saved. It shows in every company you work for." };
  });
}

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  return attempt(async () => {
    const f = fields(fd);
    const current = f.req("current", "Current password");
    const next = f.req("next", "New password");
    if (next.length < 8) throw new FormError("New password must be at least 8 characters.");
    if (next !== f.str("confirm")) throw new FormError("Passwords do not match.");
    const user = await rootDb.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new FormError("Current password is incorrect.");
    await rootDb.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    await rootDb.auditLog.create({ data: { companyId: null, userId: me.id, action: "change_password", entity: "user", entityId: me.id } });
    return { ok: "Password updated." };
  });
}
