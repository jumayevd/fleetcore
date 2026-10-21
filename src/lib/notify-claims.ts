import "server-only";
import { db } from "./db";
import { esc, sendMessage, telegramConfigured } from "./telegram";
import { SETTING_GROUP_CHAT, appUrl } from "./notify";
import { CLAIM_FAULT_LABELS, CLAIM_TYPE_LABELS, TIMEZONE, type Role } from "./constants";
import { money } from "./format";
import { CLAIM_STATUS_LABELS, CLAIM_SEVERITY_LABELS, type ClaimStatus } from "@/app/(app)/claims/shared";

/**
 * Telegram alerts for the claims desk. Same recipient pattern as notify.ts: staff roles that own
 * the money and the fleet, plus whoever the claim is assigned to. Call from `after()` so a slow
 * or failing Telegram API never blocks the user's action.
 */
const CLAIM_ROLES: Role[] = ["OWNER", "ADMIN", "FLEET_MANAGER", "ACCOUNTANT"];

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

const safe = (fn: () => Promise<void>) => fn().catch((e) => console.error("[notify-claims]", e));

const CLAIM_INCLUDE = {
  load: { select: { reference: true } },
  driver: { select: { name: true } },
  truck: { select: { unitNumber: true } },
  customer: { select: { name: true } },
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
} as const;

const when = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function contextLine(c: { load: { reference: string } | null; driver: { name: string } | null; truck: { unitNumber: string } | null; customer: { name: string } | null }) {
  const parts = [c.load?.reference, c.truck?.unitNumber, c.driver?.name, c.customer?.name].filter(Boolean) as string[];
  return parts.length ? parts.map(esc).join(" · ") : "No load, unit or driver linked";
}

/** A claim was filed: the owners, fleet manager and accountant hear about it; high and critical ones also go to the group room. */
export const notifyClaimOpened = (claimId: string) => safe(async () => {
  const c = await db.claim.findUnique({ where: { id: claimId }, include: CLAIM_INCLUDE });
  if (!c) return;
  const severe = c.severity === "HIGH" || c.severity === "CRITICAL";
  const html = `${severe ? "🚨" : "🛡️"} <b>New claim ${esc(c.number)}</b> — ${esc(CLAIM_TYPE_LABELS[c.type] ?? c.type)} · ${esc(CLAIM_SEVERITY_LABELS[c.severity] ?? c.severity)} severity\n`
    + `${contextLine(c)}\n`
    + `Incident ${esc(when(c.incidentAt))}${c.location ? ` at ${esc(c.location)}` : ""}\n`
    + `Claimed ${esc(money(c.amountClaimed))} · fault ${esc((CLAIM_FAULT_LABELS[c.fault] ?? c.fault).toLowerCase())}`
    + (c.assignedTo ? `\nAssigned to ${esc(c.assignedTo.name)}` : "\nNot assigned yet")
    + `\n\n${esc(clip(c.description))}`
    + `\n— ${esc(c.createdBy?.name ?? "System")}`;
  const chats = await chatsFor(CLAIM_ROLES, [c.assignedToId]);
  await broadcast([...chats, severe ? await groupChat() : null], html, { text: "Open claim", url: appUrl(`/claims/${c.id}`) });
});

const STATUS_ICON: Partial<Record<ClaimStatus, string>> = {
  APPROVED: "✅", DENIED: "❌", PAID: "💰", CLOSED: "📁", DISPUTED: "⚠️", LITIGATION: "⚖️", SUBMITTED: "📤", NEGOTIATION: "🤝",
};

/** A claim moved along its lifecycle. Money outcomes carry the settled amount. */
export const notifyClaimStatus = (claimId: string, status: string) => safe(async () => {
  const c = await db.claim.findUnique({ where: { id: claimId }, include: CLAIM_INCLUDE });
  if (!c) return;
  const label = CLAIM_STATUS_LABELS[status as ClaimStatus] ?? status;
  const settled = c.amountSettled != null && (status === "APPROVED" || status === "PAID" || status === "CLOSED" || status === "DENIED");
  const html = `${STATUS_ICON[status as ClaimStatus] ?? "🔄"} <b>${esc(c.number)}</b> — ${esc(label)}\n`
    + `${esc(CLAIM_TYPE_LABELS[c.type] ?? c.type)} · ${contextLine(c)}`
    + (settled ? `\nSettled ${esc(money(c.amountSettled))} of ${esc(money(c.amountClaimed))} claimed` : `\nClaimed ${esc(money(c.amountClaimed))}`)
    + (c.assignedTo ? `\nOwner: ${esc(c.assignedTo.name)}` : "");
  const chats = await chatsFor(CLAIM_ROLES, [c.assignedToId, c.createdById]);
  await broadcast(chats, html, { text: "Open claim", url: appUrl(`/claims/${c.id}`) });
});
