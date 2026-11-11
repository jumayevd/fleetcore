import "server-only";
import { rootDb } from "@/lib/db-root";
import { open, seal } from "@/lib/secret-box";
import { MAIL_PROVIDERS, type MailboxState, type MailProvider } from "./shared";
import { MailError, isConfigured, providerLabel, refreshTokens, revoke, type Tokens } from "./providers";

/*
 * A person's connected mailboxes (MailAccount, one per provider). They belong to the account, not a company, so they
 * go through rootDb. Tokens are sealed with AUTH_SECRET; a token that can't be opened (AUTH_SECRET changed) or that the
 * provider no longer accepts drops the connection, and the person is asked to connect again.
 */

export async function mailboxes(userId: string): Promise<MailboxState[]> {
  const rows = await rootDb.mailAccount.findMany({ where: { userId }, select: { provider: true, email: true } });
  return MAIL_PROVIDERS.map((provider) => ({
    provider, configured: isConfigured(provider), email: rows.find((r) => r.provider === provider)?.email ?? null,
  }));
}

export async function saveMailbox(userId: string, provider: MailProvider, email: string, t: Tokens) {
  const prev = await rootDb.mailAccount.findUnique({ where: { userId_provider: { userId, provider } }, select: { refreshTokenEnc: true } });
  // Google sends a refresh token only on the first consent; keep the one we have when none comes back.
  const refresh = t.refreshToken ? seal(t.refreshToken) : prev?.refreshTokenEnc;
  if (!refresh) throw new MailError(`${providerLabel(provider)} didn't allow offline sending. Connect it again and accept every permission.`);
  const data = { email, refreshTokenEnc: refresh, accessTokenEnc: seal(t.accessToken), accessExpiresAt: t.expiresAt };
  await rootDb.mailAccount.upsert({ where: { userId_provider: { userId, provider } }, create: { userId, provider, ...data }, update: data });
}

export async function disconnectMailbox(userId: string, provider: MailProvider) {
  const row = await rootDb.mailAccount.findUnique({ where: { userId_provider: { userId, provider } } });
  if (!row) return null;
  const refresh = open(row.refreshTokenEnc);
  if (refresh) await revoke(provider, refresh);
  await rootDb.mailAccount.delete({ where: { id: row.id } });
  return row.email;
}

/** A usable access token for the mailbox, refreshed when it is about to run out. */
export async function accessToken(userId: string, provider: MailProvider): Promise<{ token: string; email: string }> {
  const row = await rootDb.mailAccount.findUnique({ where: { userId_provider: { userId, provider } } });
  const label = providerLabel(provider);
  if (!row) throw new MailError(`Connect your ${label} first.`);
  const current = row.accessTokenEnc ? open(row.accessTokenEnc) : null;
  if (current && row.accessExpiresAt && row.accessExpiresAt.getTime() > Date.now() + 60_000) return { token: current, email: row.email };
  const refresh = open(row.refreshTokenEnc);
  const drop = async (why: string) => {
    await rootDb.mailAccount.delete({ where: { id: row.id } }).catch(() => undefined);
    throw new MailError(why);
  };
  if (!refresh) return drop(`The ${label} connection can't be used any more. Connect it again.`);
  try {
    const t = await refreshTokens(provider, refresh);
    await rootDb.mailAccount.update({
      where: { id: row.id },
      // Microsoft hands out a new refresh token each time; Google keeps the old one.
      data: { accessTokenEnc: seal(t.accessToken), accessExpiresAt: t.expiresAt, ...(t.refreshToken ? { refreshTokenEnc: seal(t.refreshToken) } : {}) },
    });
    return { token: t.accessToken, email: row.email };
  } catch (e) {
    if (e instanceof MailError && /expired/.test(e.message)) return drop(e.message);
    throw e;
  }
}
