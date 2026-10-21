"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sendMessage, setWebhook } from "@/lib/telegram";
import { SETTING_GROUP_CHAT, SETTING_GROUP_CODE, sendDailyDigest } from "@/lib/notify";
import type { ActionState } from "@/lib/action";

const code = () => randomBytes(12).toString("base64url"); // 16 chars, valid for t.me ?start=

// ---------- Personal ----------
export async function startTelegramLink() {
  const me = await requireUser();
  await db.user.update({ where: { id: me.id }, data: { telegramLinkCode: code() } });
  revalidatePath("/account");
}

export async function disconnectTelegram() {
  const me = await requireUser();
  await db.user.update({ where: { id: me.id }, data: { telegramChatId: null, telegramLinkCode: null } });
  await audit(me.id, "unlink_telegram", "user", me.id);
  revalidatePath("/account");
}

export async function setTelegramAlerts(enabled: boolean) {
  const me = await requireUser();
  await db.user.update({ where: { id: me.id }, data: { telegramAlerts: enabled } });
  revalidatePath("/account");
}

export async function sendMeTest(): Promise<ActionState> {
  const me = await requireUser();
  const u = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!u.telegramChatId) return { error: "Telegram isn't connected" };
  try {
    await sendMessage(u.telegramChatId, `🔔 Test alert for <b>${u.name}</b>. Alerts are working.`);
    return { ok: "Test message sent — check Telegram" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------- Admin ----------
export async function registerWebhook(): Promise<ActionState> {
  const me = await requireUser("users.manage");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/api/telegram/webhook`;
  if (!url.startsWith("https://") || /localhost|127\.0\.0\.1/.test(url)) {
    return { error: "Telegram needs a public HTTPS URL. Do this from the deployed site, not localhost." };
  }
  try {
    await setWebhook(url);
    await audit(me.id, "telegram_webhook", "system", null, url);
    revalidatePath("/admin/telegram");
    return { ok: `Webhook connected: ${url}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function newGroupCode() {
  await requireUser("users.manage");
  const value = code();
  await db.appSetting.upsert({ where: { key: SETTING_GROUP_CODE }, update: { value }, create: { key: SETTING_GROUP_CODE, value } });
  revalidatePath("/admin/telegram");
}

export async function disconnectGroup() {
  const me = await requireUser("users.manage");
  await db.appSetting.deleteMany({ where: { key: SETTING_GROUP_CHAT } });
  await audit(me.id, "unlink_telegram_group", "system");
  revalidatePath("/admin/telegram");
}

export async function sendDigestNow(): Promise<ActionState> {
  await requireUser("users.manage");
  try {
    const r = await sendDailyDigest();
    return r.sent ? { ok: `Digest sent (${r.alerts} alerts)` } : { error: r.reason };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
