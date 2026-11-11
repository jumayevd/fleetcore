import "server-only";
import { headers } from "next/headers";
import { open, seal } from "@/lib/secret-box";
import type { MailProvider } from "./shared";

/*
 * The round trip to Google or Microsoft and back. Before leaving, FleetCore sets a short-lived, sealed, httpOnly cookie
 * with a random state, who is connecting and where to come back to; the callback only accepts a code whose state
 * matches it, for the same signed-in person (so a link can't attach someone else's mailbox to your account).
 */

export const MAIL_STATE_COOKIE = "fo_mail_oauth";
export const MAIL_STATE_TTL_S = 600;

export type MailState = { state: string; provider: MailProvider; userId: string; returnTo: string };

export const sealState = (s: MailState) => seal(JSON.stringify(s));

export function openState(value: string | undefined): MailState | null {
  if (!value) return null;
  const raw = open(value);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as MailState;
    return typeof s.state === "string" && typeof s.userId === "string" && typeof s.returnTo === "string" ? s : null;
  } catch {
    return null;
  }
}

/** Only paths on this site: "/vendors/x", never "//evil.example" or a full URL. */
export const safeReturn = (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard");

/** This site's address for the provider's redirect URI: APP_URL when set, else the host the request came to. */
export async function siteOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** returnTo with ?mail=… added, to tell the page how the connection went. */
export function withMailResult(returnTo: string, result: string, provider?: MailProvider) {
  const [path, hash] = returnTo.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}mail=${encodeURIComponent(result)}${provider ? `&provider=${provider.toLowerCase()}` : ""}${hash ? `#${hash}` : ""}`;
}
