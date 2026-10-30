import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { rootDb } from "./db-root";
import { isRole, type Role } from "./constants";
import { isProfileComplete } from "./profile";
import { ACTIVE_COOKIE, parseWorkspaceKey, workspaceKey, type WorkspaceAccount } from "./workspace-shared";

/*
 * Sessions, Gmail-style: one browser can be signed in to several accounts at once (each added with its own password),
 * and works in one company of one of those accounts at a time.
 *
 *  - fo_session (httpOnly, signed): the signed-in accounts, each with the time it signed in. Each sign-in lasts
 *    ACCOUNT_TTL on its own, so adding a second account never extends the first.
 *  - fo_active (readable by the page, not trusted): "<userId>.<companyId>". Every request re-checks that the user is
 *    one of the signed-in accounts and still an active member of that company, so editing the cookie gains nothing.
 *    The page reads it only to notice that another tab switched company.
 */

export const SESSION_COOKIE = "fo_session";
const ACCOUNT_TTL_S = 60 * 60 * 24 * 14;
/** More than this and the oldest sign-in drops off. */
export const MAX_ACCOUNTS = 6;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars) in .env");
  return new TextEncoder().encode(s);
}

const secure = () => process.env.NODE_ENV === "production";
const nowS = () => Math.floor(Date.now() / 1000);

export type SessionAccount = { userId: string; /** Epoch seconds of the sign-in. */ at: number };

async function readAccounts(token: string | undefined): Promise<SessionAccount[]> {
  if (!token) return [];
  try {
    const { payload } = await jwtVerify(token, secret());
    const raw = Array.isArray(payload.acc) ? (payload.acc as unknown[]) : [];
    const now = nowS();
    return raw
      .filter((a): a is { u: string; t: number } => typeof a === "object" && a !== null && typeof (a as { u?: unknown }).u === "string" && typeof (a as { t?: unknown }).t === "number")
      .filter((a) => now - a.t < ACCOUNT_TTL_S)
      .map((a) => ({ userId: a.u, at: a.t }));
  } catch {
    return [];
  }
}

/** Replace the signed-in accounts (most recent first). Server actions and route handlers only. */
export async function writeAccounts(accounts: SessionAccount[]) {
  const jar = await cookies();
  const list = accounts.slice(0, MAX_ACCOUNTS);
  if (!list.length) {
    jar.delete(SESSION_COOKIE);
    jar.delete(ACTIVE_COOKIE);
    return;
  }
  const exp = Math.max(...list.map((a) => a.at)) + ACCOUNT_TTL_S;
  const token = await new SignJWT({ acc: list.map((a) => ({ u: a.userId, t: a.at })) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret());
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: exp - nowS() });
  forgetSessions();
}

/**
 * Only accounts that still exist and are active, signed in since their password last changed. A signed cookie can
 * outlive its user (deleted, deactivated, or a reseeded database) or its password: such entries are ignored, so they
 * never count as "signed in".
 */
async function liveAccounts(accounts: SessionAccount[]) {
  if (!accounts.length) return accounts;
  const rows = await rootDb.user.findMany({ where: { id: { in: accounts.map((a) => a.userId) }, active: true }, select: { id: true, sessionsValidFrom: true } });
  const from = new Map(rows.map((r) => [r.id, r.sessionsValidFrom?.getTime() ?? 0]));
  return accounts.filter((a) => from.has(a.userId) && a.at * 1000 >= from.get(a.userId)!);
}

/** Signed-in accounts, as written: use in actions that are about to change them. */
export async function currentAccounts() {
  return liveAccounts(await readAccounts((await cookies()).get(SESSION_COOKIE)?.value));
}

/** Add (or refresh) an account after a successful password check. */
export async function addAccount(userId: string) {
  const others = (await currentAccounts()).filter((a) => a.userId !== userId);
  await writeAccounts([{ userId, at: nowS() }, ...others]);
}

/** After a password change: the account's sign-ins in every other browser end; this browser stays signed in. */
export async function endOtherSessions(userId: string) {
  const at = nowS();
  await rootDb.user.update({ where: { id: userId }, data: { sessionsValidFrom: new Date(at * 1000) } });
  const others = (await currentAccounts()).filter((a) => a.userId !== userId);
  await writeAccounts([{ userId, at }, ...others]);
}

/** Point this browser at a company. Pass null to leave it on the chooser. */
export async function writeActive(userId: string, companyId: string | null) {
  const jar = await cookies();
  if (!companyId) jar.delete(ACTIVE_COOKIE);
  else jar.set(ACTIVE_COOKIE, workspaceKey(userId, companyId), { httpOnly: false, sameSite: "lax", secure: secure(), path: "/", maxAge: ACCOUNT_TTL_S });
  forgetSessions();
}

/* ------------------------------------------------------------------ */
/* Resolving the request's account and company                         */
/* ------------------------------------------------------------------ */

export type ActiveContext = {
  /** profileComplete: first and last name, ID number and date of birth are on file (src/lib/profile.ts). */
  user: { id: string; name: string; email: string; phone: string | null; lastLoginAt: Date | null; profileComplete: boolean };
  company: { id: string; name: string; color: string | null; units: string; timezone: string; currency: string };
  role: Role;
  /** "" when a platform owner works here without being a member (platform: true). */
  membershipId: string;
  platform: boolean;
};

/** Platform owners (src/lib/platform.ts) open every company as an owner without a membership. */
const PLATFORM_OWNER = "OWNER";
export type SessionContext = { accounts: SessionAccount[]; active: ActiveContext | null };

async function resolve(token: string | undefined, activeRaw: string | undefined): Promise<SessionContext> {
  const accounts = await liveAccounts(await readAccounts(token));
  if (!accounts.length) return { accounts, active: null };
  const ref = parseWorkspaceKey(activeRaw);
  if (!ref || !accounts.some((a) => a.userId === ref.userId)) return { accounts, active: null };
  const m = await rootDb.membership.findUnique({
    where: { userId_companyId: { userId: ref.userId, companyId: ref.companyId } },
    select: {
      id: true, role: true, active: true,
      user: { select: { id: true, name: true, email: true, phone: true, lastLoginAt: true, active: true, firstName: true, lastName: true, idNumber: true, birthDate: true } },
      company: { select: { id: true, name: true, color: true, units: true, timezone: true, currency: true } },
    },
  });
  const asUser = (u: NonNullable<typeof m>["user"]) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, lastLoginAt: u.lastLoginAt, profileComplete: isProfileComplete(u) });
  if (m && m.active && m.user.active && isRole(m.role)) return { accounts, active: { user: asUser(m.user), company: m.company, role: m.role, membershipId: m.id, platform: false } };
  // Not a member: only a platform owner may work here, as an owner.
  const [u, company] = await Promise.all([
    rootDb.user.findUnique({ where: { id: ref.userId }, select: { id: true, name: true, email: true, phone: true, lastLoginAt: true, active: true, firstName: true, lastName: true, idNumber: true, birthDate: true, platformRole: true } }),
    rootDb.company.findUnique({ where: { id: ref.companyId }, select: { id: true, name: true, color: true, units: true, timezone: true, currency: true } }),
  ]);
  if (!u?.active || u.platformRole !== PLATFORM_OWNER || !company) return { accounts, active: null };
  return { accounts, active: { user: asUser(u), company, role: "OWNER", membershipId: "", platform: true } };
}

// Server actions and route handlers do not share React's per-request cache, and the company scope resolves the session
// on every query. A short memo keyed by the exact cookie values keeps that to one lookup; a removed member loses access
// within MEMO_MS at most (and at once on this server instance, see forgetSessions).
const MEMO_MS = 5_000;
const memo = new Map<string, { at: number; value: Promise<SessionContext> }>();

/** Drop memoised sessions after memberships, roles or accounts change. */
export function forgetSessions() {
  memo.clear();
}

export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { accounts: [], active: null };
  const activeRaw = jar.get(ACTIVE_COOKIE)?.value;
  const key = `${token}|${activeRaw ?? ""}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  const value = resolve(token, activeRaw);
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 1000) for (const [k, v] of memo) if (Date.now() - v.at >= MEMO_MS) memo.delete(k);
  value.catch(() => memo.delete(key));
  return value;
});

/* ------------------------------------------------------------------ */
/* Workspaces (every signed-in account × its companies)               */
/* ------------------------------------------------------------------ */

/** Every signed-in account with its companies (Alt+1…9, the command palette), in sign-in order (most recent account first), companies by name. */
export async function listWorkspaces(accounts: SessionAccount[]): Promise<WorkspaceAccount[]> {
  if (!accounts.length) return [];
  const users = await rootDb.user.findMany({
    where: { id: { in: accounts.map((a) => a.userId) }, active: true },
    select: {
      id: true, name: true, email: true, platformRole: true, canCreateCompanies: true,
      memberships: {
        where: { active: true },
        orderBy: { company: { name: "asc" } },
        select: { role: true, company: { select: { id: true, name: true, color: true } } },
      },
    },
  });
  // A platform owner can open every company (as an owner), member or not.
  const everyCompany = users.some((u) => u.platformRole === PLATFORM_OWNER)
    ? await rootDb.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } })
    : [];
  return accounts.flatMap((a) => {
    const u = users.find((x) => x.id === a.userId);
    if (!u) return [];
    const platform = u.platformRole === PLATFORM_OWNER;
    return [{
      userId: u.id, name: u.name, email: u.email, platform, canCreate: platform || u.canCreateCompanies,
      companies: platform
        ? everyCompany.map((c) => ({ ...c, role: "OWNER" as Role }))
        : u.memberships.filter((m) => isRole(m.role)).map((m) => ({ ...m.company, role: m.role as Role })),
    }];
  });
}
