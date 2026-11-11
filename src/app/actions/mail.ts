"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { disconnectMailbox } from "@/lib/mail/accounts";
import { providerLabel } from "@/lib/mail/providers";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail/shared";
import type { ActionState } from "@/lib/action";

/** Forget a connected Gmail / Outlook: FleetCore can no longer send as that mailbox (Google is told to revoke it). */
export async function disconnectMail(provider: MailProvider, path?: string): Promise<ActionState> {
  const me = await requireUser();
  if (!(MAIL_PROVIDERS as readonly string[]).includes(provider)) return { error: "Unknown mail provider" };
  const email = await disconnectMailbox(me.id, provider);
  if (path?.startsWith("/")) revalidatePath(path);
  return { ok: email ? `${providerLabel(provider)} ${email} disconnected` : "Already disconnected" };
}
