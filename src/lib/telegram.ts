import "server-only";
import { createHash } from "node:crypto";

/**
 * Minimal Telegram Bot API client. Configure with TELEGRAM_BOT_TOKEN (from
 * @BotFather). Everything is a no-op when the token isn't set.
 */
const token = () => process.env.TELEGRAM_BOT_TOKEN;
export const telegramConfigured = () => Boolean(token());

/** Shared secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token; derived so no extra env var is needed. */
export function webhookSecret() {
  return createHash("sha256").update(`${process.env.AUTH_SECRET}:telegram-webhook`).digest("hex").slice(0, 48);
}

async function call<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const t = token();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendMessage(chatId: string, html: string, button?: { text: string; url: string }) {
  // Telegram rejects localhost URLs in buttons, so only attach real links.
  const markup = button && /^https:\/\//.test(button.url) && !button.url.includes("localhost")
    ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } } : {};
  return call("sendMessage", { chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...markup });
}

let me: { username: string; first_name: string } | null = null;
export async function getBot() {
  if (!me) me = await call<{ username: string; first_name: string }>("getMe");
  return me;
}

export async function setWebhook(url: string) {
  return call("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"], drop_pending_updates: true });
}

export async function getWebhookInfo() {
  return call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo");
}
