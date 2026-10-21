import { TIMEZONE } from "@/lib/constants";

/**
 * Runs once per server instance. Server-side dates follow the company timezone: Vercel functions run in UTC, so
 * without this every server-rendered date, "today" / week boundary (date-fns startOfDay, startOfWeek) and
 * datetime-local form value would be read and shown hours off from company time. Stored instants are unaffected.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") process.env.TZ = TIMEZONE;
}
