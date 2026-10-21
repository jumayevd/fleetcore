import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { db } from "./db";
import { can, homeFor, type Permission } from "./permissions";

const COOKIE = "lp_session";
const MAX_AGE = 60 * 60 * 12; // 12h

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars) in .env");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, active: true, phone: true, teamId: true, lastLoginAt: true, driver: { select: { id: true } } },
    });
    if (!user || !user.active) return null;
    return user;
  } catch {
    return null;
  }
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Use in pages/actions: redirects to login if signed out, home if lacking permission. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect(homeFor(user.role));
  return user;
}
