import "server-only";
import { MAIL_PROVIDERS, type MailProvider } from "./shared";

/*
 * The two mail providers a person can connect (OAuth 2.0, authorization code flow). FleetCore asks only for permission
 * to SEND as the person (Gmail: gmail.send; Microsoft: Mail.Send) plus their address; it can never read the mailbox.
 *
 * Each needs an app registered with the provider; its id and secret come from the environment:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET        (Google Cloud console → APIs & Services → Credentials)
 *   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET  (Microsoft Entra admin center → App registrations)
 * The redirect URI to register is <site>/api/mail/callback/google (or /microsoft). A provider without both values is
 * shown as "not set up" and can't be connected.
 */

type Config = {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Extra parameters on the consent screen (a refresh token, the account picker). */
  authorizeExtra: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
};

const config = (p: MailProvider): Config =>
  p === "GOOGLE"
    ? {
        label: "Gmail",
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scope: "openid email https://www.googleapis.com/auth/gmail.send",
        authorizeExtra: { access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true" },
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }
    : {
        label: "Outlook",
        authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scope: "openid email offline_access User.Read Mail.Send",
        authorizeExtra: { prompt: "select_account" },
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      };

export class MailError extends Error {}

export const providerFromSlug = (slug: string): MailProvider | null =>
  MAIL_PROVIDERS.find((p) => p.toLowerCase() === slug.toLowerCase()) ?? (slug === "outlook" ? "MICROSOFT" : slug === "gmail" ? "GOOGLE" : null);

export const providerLabel = (p: MailProvider) => config(p).label;

/** Whether the provider's app id and secret are set, so people can connect it. */
export const isConfigured = (p: MailProvider) => Boolean(config(p).clientId && config(p).clientSecret);

export const redirectUri = (origin: string, p: MailProvider) => `${origin}/api/mail/callback/${p.toLowerCase()}`;

export function authorizeUrl(p: MailProvider, origin: string, state: string, loginHint?: string) {
  const c = config(p);
  const q = new URLSearchParams({
    client_id: c.clientId ?? "", redirect_uri: redirectUri(origin, p), response_type: "code", scope: c.scope, state, ...c.authorizeExtra,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${c.authorizeUrl}?${q}`;
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date };

async function tokenRequest(p: MailProvider, body: Record<string, string>): Promise<Tokens> {
  const c = config(p);
  if (!c.clientId || !c.clientSecret) throw new MailError(`${c.label} is not set up on this FleetCore yet.`);
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    // invalid_grant: the person revoked access, changed their password, or the refresh token expired.
    if (data.error === "invalid_grant") throw new MailError(`The ${c.label} connection has expired. Connect it again.`);
    throw new MailError(`${c.label} refused the sign-in (${data.error ?? res.status}).`);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000) };
}

export const exchangeCode = (p: MailProvider, code: string, origin: string) =>
  tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(origin, p) });

export const refreshTokens = (p: MailProvider, refreshToken: string) =>
  tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken, ...(p === "MICROSOFT" ? { scope: config(p).scope } : {}) });

/** The address of the mailbox that was just connected. */
export async function mailboxAddress(p: MailProvider, accessToken: string): Promise<string> {
  const url = p === "GOOGLE" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { email?: string; mail?: string | null; userPrincipalName?: string };
  const email = p === "GOOGLE" ? data.email : (data.mail ?? data.userPrincipalName);
  if (!res.ok || !email) throw new MailError(`Couldn't read the ${providerLabel(p)} address.`);
  return email;
}

/** Best effort: tell Google to forget the grant when someone disconnects (Microsoft has no per-app revoke endpoint). */
export async function revoke(p: MailProvider, refreshToken: string) {
  if (p !== "GOOGLE") return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
}
