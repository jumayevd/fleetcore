import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { esc, sendMessage, webhookSecret } from "@/lib/telegram";
import { SETTING_GROUP_CHAT, SETTING_GROUP_CODE, appUrl } from "@/lib/notify";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { audit } from "@/lib/audit";

type Update = { message?: { text?: string; chat: { id: number; type: string; title?: string }; from?: { first_name?: string } } };

const HELP = "Commands:\n/status — live operations summary\n/stop — stop receiving alerts here\n/help — this message\n\nTo link your account, open <b>My account → Connect Telegram</b> in FleetOps.";

function validSecret(req: Request) {
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(webhookSecret());
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!validSecret(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const update = (await req.json().catch(() => ({}))) as Update;
  const msg = update.message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const [cmdRaw, arg] = msg.text.trim().split(/\s+/, 2);
  const cmd = cmdRaw.split("@")[0].toLowerCase(); // "/start@MyBot" in groups
  const reply = (html: string) => sendMessage(chatId, html).catch((e) => console.error("[telegram webhook]", e));

  if (cmd === "/start" && !isGroup) {
    if (!arg) { await reply(`👋 This is the FleetOps alerts bot.\n\n${HELP}`); return NextResponse.json({ ok: true }); }
    const user = await db.user.findUnique({ where: { telegramLinkCode: arg } });
    if (!user || !user.active) { await reply("That link has expired. Open <b>My account</b> in FleetOps and press <b>Connect Telegram</b> again."); return NextResponse.json({ ok: true }); }
    await db.user.updateMany({ where: { telegramChatId: chatId, id: { not: user.id } }, data: { telegramChatId: null } });
    await db.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkCode: null, telegramAlerts: true } });
    await audit(user.id, "link_telegram", "user", user.id);
    await reply(`✅ Linked to <b>${esc(user.name)}</b> (${esc(ROLE_LABELS[user.role as Role])}).\nYou'll get alerts for your role here.\n\n${HELP}`);
  } else if (cmd === "/connect" && isGroup) {
    const code = await db.appSetting.findUnique({ where: { key: SETTING_GROUP_CODE } });
    if (!arg || !code || arg !== code.value) { await reply("Invalid code. An admin can find it under <b>Admin → Telegram</b>."); return NextResponse.json({ ok: true }); }
    await db.appSetting.upsert({ where: { key: SETTING_GROUP_CHAT }, update: { value: chatId }, create: { key: SETTING_GROUP_CHAT, value: chatId } });
    await db.appSetting.delete({ where: { key: SETTING_GROUP_CODE } });
    await audit(null, "link_telegram_group", "system", null, msg.chat.title ?? chatId);
    await reply(`✅ <b>${esc(msg.chat.title ?? "This group")}</b> will now receive company operations alerts.`);
  } else if (cmd === "/stop") {
    if (isGroup) await db.appSetting.deleteMany({ where: { key: SETTING_GROUP_CHAT, value: chatId } });
    else await db.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
    await reply("🔕 Alerts stopped for this chat.");
  } else if (cmd === "/status") {
    // Only linked staff (or the linked company group) may see operations data.
    const staff = await db.user.findFirst({ where: { telegramChatId: chatId, active: true, role: { not: "DRIVER" } } });
    const group = await db.appSetting.findFirst({ where: { key: SETTING_GROUP_CHAT, value: chatId } });
    if (!staff && !group) { await reply("This chat isn't linked to a staff account."); return NextResponse.json({ ok: true }); }
    const [counts, trucks] = await Promise.all([
      db.load.groupBy({ by: ["status"], _count: true }),
      db.truck.groupBy({ by: ["status"], _count: true }),
    ]);
    const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
    const t = (s: string) => trucks.find((c) => c.status === s)?._count ?? 0;
    await reply(`📊 <b>Right now</b>\n🚚 In transit: ${n("IN_TRANSIT")}\n📋 Awaiting pickup: ${n("ASSIGNED")}\n⏳ Unassigned: ${n("PLANNED")}\n🧾 Delivered, not invoiced: ${n("DELIVERED")}\n🛠 Trucks in maintenance: ${t("MAINTENANCE")}\n\n${appUrl("/dashboard")}`);
  } else if (cmd === "/help" || cmd === "/start") {
    await reply(HELP);
  }
  return NextResponse.json({ ok: true });
}
