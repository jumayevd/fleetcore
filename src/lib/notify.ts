import "server-only";
import { db } from "./db";
import { esc, sendMessage, telegramConfigured } from "./telegram";
import { getAlerts } from "./alerts";
import { LOAD_STATUS_LABELS, type LoadStatus, type Role } from "./constants";
import { DOC_KIND_LABELS } from "./documents";
import { money } from "./format";

/**
 * Who hears about what, over Telegram. Call these from `after()` so a slow or
 * failing Telegram API never blocks or breaks the user's action.
 */
export const SETTING_GROUP_CHAT = "telegram.groupChatId";
export const SETTING_GROUP_CODE = "telegram.groupCode";

export function appUrl(path = "") {
  const base = process.env.APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return base.replace(/\/$/, "") + path;
}

const OPS: Role[] = ["OWNER", "ADMIN", "DISPATCHER"];

async function chatsFor(roles: Role[], extraUserIds: (string | null | undefined)[] = []) {
  const users = await db.user.findMany({
    where: {
      active: true, telegramAlerts: true, telegramChatId: { not: null },
      OR: [{ role: { in: roles } }, { id: { in: extraUserIds.filter(Boolean) as string[] } }],
    },
    select: { telegramChatId: true },
  });
  return users.map((u) => u.telegramChatId!);
}

async function groupChat() {
  return (await db.appSetting.findUnique({ where: { key: SETTING_GROUP_CHAT } }))?.value ?? null;
}

async function broadcast(chats: (string | null)[], html: string, button?: { text: string; url: string }) {
  if (!telegramConfigured()) return;
  const unique = [...new Set(chats.filter(Boolean) as string[])];
  const results = await Promise.allSettled(unique.map((c) => sendMessage(c, html, button)));
  for (const r of results) if (r.status === "rejected") console.error("[telegram]", r.reason);
}

const safe = (fn: () => Promise<void>) => fn().catch((e) => console.error("[notify]", e));

// ---------- Loads ----------
export const notifyLoadStatus = (loadId: string, to: LoadStatus) => safe(async () => {
  const l = await db.load.findUnique({ where: { id: loadId }, include: { driver: { select: { name: true, userId: true } }, truck: { select: { unitNumber: true } }, customer: { select: { name: true } } } });
  if (!l) return;
  const icon = { IN_TRANSIT: "🚚", DELIVERED: "✅", CANCELLED: "❌", INVOICED: "🧾", PLANNED: "↩️", ASSIGNED: "📋", TONU: "🚫" }[to];
  const html = `${icon} <b>${esc(l.reference)}</b> — ${esc(LOAD_STATUS_LABELS[to])}\n${esc(l.originCity)} → ${esc(l.destCity)} · ${esc(l.customer.name)}`
    + (l.truck ? `\n${esc(l.truck.unitNumber)} · ${esc(l.driver?.name)}` : "")
    + (to === "DELIVERED" && l.podSignedBy ? `\nPOD signed by ${esc(l.podSignedBy)}` : "");
  const btn = { text: "Open load", url: appUrl(`/loads/${l.id}`) };
  const staff = to === "DELIVERED" ? [...OPS, "ACCOUNTANT" as Role] : OPS;
  const chats = await chatsFor(staff, [l.dispatcherId]);
  // Tell the driver when their trip is pulled.
  if ((to === "CANCELLED" || to === "PLANNED") && l.driver?.userId) chats.push(...(await chatsFor([], [l.driver.userId])));
  await broadcast([...chats, await groupChat()], html, btn);
});

export const notifyLoadAssigned = (loadId: string) => safe(async () => {
  const l = await db.load.findUnique({ where: { id: loadId }, include: { driver: true, truck: true, trailer: true } });
  if (!l?.driver?.userId) return;
  const html = `📋 <b>New trip: ${esc(l.reference)}</b>\n`
    + `<b>Pickup:</b> ${esc(l.originName)}, ${esc(l.pickupAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }))}\n`
    + `<b>Deliver:</b> ${esc(l.destName)} by ${esc(l.deliveryAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }))}\n`
    + `<b>Cargo:</b> ${esc(l.commodity)}, ${Math.round(l.weightKg).toLocaleString()} kg${l.temperatureC != null ? `, keep at ${l.temperatureC}°C` : ""}${l.hazmat ? " ⚠️ HAZMAT" : ""}\n`
    + `<b>Truck:</b> ${esc(l.truck?.unitNumber)}${l.trailer ? ` + ${esc(l.trailer.unitNumber)}` : ""}`
    + (l.notes ? `\n\n📝 ${esc(l.notes)}` : "");
  await broadcast(await chatsFor([], [l.driver.userId]), html, { text: "Open in driver app", url: appUrl("/driver") });
});

export const notifyLoadIssue = (loadId: string, message: string, byUserId: string) => safe(async () => {
  const [l, by] = await Promise.all([
    db.load.findUnique({ where: { id: loadId }, include: { truck: { select: { unitNumber: true } } } }),
    db.user.findUnique({ where: { id: byUserId }, select: { name: true } }),
  ]);
  if (!l) return;
  const html = `🚨 <b>Issue on ${esc(l.reference)}</b>${l.truck ? ` (${esc(l.truck.unitNumber)})` : ""}\n${esc(message)}\n— ${esc(by?.name)}`;
  await broadcast([...(await chatsFor(OPS, [l.dispatcherId])), await groupChat()], html, { text: "Open load", url: appUrl(`/loads/${l.id}`) });
});

export const notifyDocumentUploaded = (documentId: string) => safe(async () => {
  const d = await db.document.findUnique({ where: { id: documentId }, include: { load: true, uploadedBy: { select: { name: true, role: true } } } });
  if (!d?.load) return;
  // Only paperwork that someone needs to act on.
  if (!["POD", "CMR", "CUSTOMS"].includes(d.kind)) return;
  const roles: Role[] = d.kind === "POD" ? ["ACCOUNTANT", ...OPS] : OPS;
  const html = `📎 <b>${esc(DOC_KIND_LABELS[d.kind])}</b> uploaded for <b>${esc(d.load.reference)}</b> by ${esc(d.uploadedBy?.name)}`
    + (d.kind === "POD" && d.load.status === "DELIVERED" ? "\nReady to invoice." : "");
  await broadcast(await chatsFor(roles, [d.load.dispatcherId]), html, { text: "Open load", url: appUrl(`/loads/${d.load.id}`) });
});

// ---------- Money & fleet ----------
export const notifyInvoicePaid = (invoiceId: string) => safe(async () => {
  const i = await db.invoice.findUnique({ where: { id: invoiceId }, include: { customer: { select: { name: true } } } });
  if (!i) return;
  const html = `💰 <b>${esc(i.number)} paid</b> — ${esc(money(i.amount * (1 + i.taxRate)))}\n${esc(i.customer.name)}`;
  await broadcast(await chatsFor(["OWNER", "ACCOUNTANT"]), html, { text: "Open invoice", url: appUrl(`/finance/invoices/${i.id}`) });
});

export const notifyMaintenance = (recordId: string, status: string) => safe(async () => {
  const m = await db.workOrder.findUnique({ where: { id: recordId }, include: { truck: { select: { unitNumber: true, id: true } }, trailer: { select: { unitNumber: true } } } });
  if (!m) return;
  const unit = m.truck?.unitNumber ?? m.trailer?.unitNumber ?? "Unit";
  const html = status === "DONE"
    ? `🔧 <b>${esc(unit)}</b> back in service — ${esc(m.title)} done (${esc(money(m.cost))})`
    : `🔧 <b>${esc(unit)}</b> in the shop — ${esc(m.title)}${m.vendor ? ` @ ${esc(m.vendor)}` : ""}`;
  const url = m.truck ? appUrl(`/fleet/${m.truck.id}`) : appUrl(`/maintenance/work-orders/${m.id}`);
  await broadcast(await chatsFor(["FLEET_MANAGER", "OWNER", "ADMIN", "DISPATCHER"]), html, { text: "Open work order", url });
});

// ---------- Daily digest (cron) ----------
export async function sendDailyDigest() {
  if (!telegramConfigured()) return { sent: false, reason: "TELEGRAM_BOT_TOKEN not set" };
  const [alerts, counts] = await Promise.all([getAlerts(), db.load.groupBy({ by: ["status"], _count: true })]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const critical = alerts.filter((a) => a.level === "critical");
  const warning = alerts.filter((a) => a.level === "warning");
  const line = (a: (typeof alerts)[number]) => `• ${esc(a.title)} — ${esc(a.detail)}`;
  const html = `☀️ <b>Daily operations brief</b>\n`
    + `🚚 ${n("IN_TRANSIT")} in transit · 📋 ${n("ASSIGNED")} awaiting pickup · ⏳ ${n("PLANNED")} unassigned · 🧾 ${n("DELIVERED")} to invoice\n`
    + (critical.length ? `\n🔴 <b>Critical (${critical.length})</b>\n${critical.slice(0, 12).map(line).join("\n")}\n` : "")
    + (warning.length ? `\n🟠 <b>Attention (${warning.length})</b>\n${warning.slice(0, 12).map(line).join("\n")}` : "")
    + (!alerts.length ? "\n✅ Nothing needs attention today." : "");
  await broadcast([...(await chatsFor(["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER"])), await groupChat()], html, { text: "Open dashboard", url: appUrl("/dashboard") });
  return { sent: true, alerts: alerts.length };
}
