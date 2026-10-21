"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";

// bcrypt hash of a random string; only used to equalise timing for unknown emails.
const DUMMY_HASH = "$2b$10$Dfob35lSw0BVw8zEqfQSY.8DFhc6CSl6DeU4B3W3T1BW03c0vUecO";

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  // Always run one bcrypt compare so response time doesn't reveal which emails are registered.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(user.id, "login", "user", user.id);
  redirect(homeFor(user.role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser();
  return attempt(async () => {
    const f = fields(fd);
    const current = f.req("current", "Current password");
    const next = f.req("next", "New password");
    if (next.length < 8) throw new FormError("New password must be at least 8 characters.");
    if (next !== f.str("confirm")) throw new FormError("Passwords do not match.");
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new FormError("Current password is incorrect.");
    await db.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    await audit(me.id, "change_password", "user", me.id);
    return { ok: "Password updated." };
  });
}
