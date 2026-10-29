import "server-only";
import { headers } from "next/headers";
import { rootDb } from "@/lib/db-root";

/*
 * Brakes on password guessing, counted in the database so every server instance sees the same numbers:
 *  - one email: 5 wrong passwords within 15 minutes pause sign-in for that email for 15 minutes;
 *  - one IP address: 30 wrong passwords within 15 minutes (many emails tried from one place) pause that address.
 * While paused, even the right password is refused. Emails without an account are counted the same way, so a pause
 * says nothing about whether an account exists.
 */

const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const LIMITS = { email: 5, ip: 30 } as const;
type Kind = keyof typeof LIMITS;

const keyOf = (kind: Kind, value: string) => `${kind}:${value.trim().toLowerCase()}`;

/** The caller's address. Vercel sets x-forwarded-for itself (a client can't supply its own). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/** Whole minutes left on a pause for this email or this address; 0 when neither is paused. */
export async function pausedFor(email: string, ip: string) {
  const now = Date.now();
  const rows = await rootDb.loginThrottle.findMany({
    where: { key: { in: [keyOf("email", email), keyOf("ip", ip)] }, lockedUntil: { gt: new Date(now) } },
    select: { lockedUntil: true },
  });
  const until = Math.max(0, ...rows.map((r) => r.lockedUntil!.getTime()));
  return until ? Math.max(1, Math.ceil((until - now) / 60_000)) : 0;
}

export const pausedMessage = (minutes: number) =>
  `Too many wrong passwords. Sign-in is paused for ${minutes} minute${minutes === 1 ? "" : "s"}; try again then.`;

/** Count one wrong password. True when this one paused the email. */
export async function recordFailure(email: string, ip: string) {
  const now = new Date();
  const floor = new Date(now.getTime() - WINDOW_MS);
  const until = new Date(now.getTime() + LOCK_MS);
  let paused = false;
  for (const kind of ["email", "ip"] as const) {
    const limit = LIMITS[kind];
    // One statement, so attempts running side by side can't overwrite each other's count. The SET expressions all
    // read the row as it was before this attempt.
    const [row] = await rootDb.$queryRaw<{ failures: number }[]>`
      INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${keyOf(kind, kind === "email" ? email : ip)}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "failures" = CASE WHEN "LoginThrottle"."windowStart" < ${floor} THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
        "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < ${floor} THEN ${now} ELSE "LoginThrottle"."windowStart" END,
        "lockedUntil" = CASE
          WHEN (CASE WHEN "LoginThrottle"."windowStart" < ${floor} THEN 1 ELSE "LoginThrottle"."failures" + 1 END) >= ${limit} THEN ${until}
          ELSE "LoginThrottle"."lockedUntil" END
      RETURNING "failures"`;
    if (kind === "email" && row?.failures === limit) paused = true;
  }
  // Old counts are no use to anyone: drop them as we go.
  await rootDb.loginThrottle.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
  });
  return paused;
}

/** A right password: that email starts from zero again. (The address keeps its count: one success doesn't excuse a spray.) */
export async function clearFailures(email: string) {
  await rootDb.loginThrottle.deleteMany({ where: { key: keyOf("email", email) } });
}
