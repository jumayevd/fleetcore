import type { Tone } from "@/components/ui";

/**
 * Where an audit entry's entity lives. `id: true` means the link needs the entity id (a detail
 * page); the others link to a list page even when the id is missing.
 */
const ENTITY_HREF: Record<string, { href: (id: string) => string; id?: true }> = {
  load: { href: (id) => `/loads/${id}`, id: true },
  truck: { href: (id) => `/fleet/${id}`, id: true },
  // Older trailer "create" entries were written without an id: those still open the trailer list.
  trailer: { href: (id) => (id ? `/fleet/trailers/${id}` : "/fleet/trailers") },
  driver: { href: (id) => `/drivers/${id}`, id: true },
  customer: { href: (id) => `/customers/${id}`, id: true },
  invoice: { href: (id) => `/finance/invoices/${id}`, id: true },
  user: { href: (id) => `/admin/users/${id}`, id: true },
  team: { href: () => "/admin/company" },
  company: { href: () => "/admin/company" },
  workOrder: { href: (id) => `/maintenance/work-orders/${id}`, id: true },
  work_order: { href: (id) => `/maintenance/work-orders/${id}`, id: true },
  claim: { href: (id) => `/claims/${id}`, id: true },
  announcement: { href: () => "/announcements" },
  system: { href: () => "/admin/telegram" },
  board: { href: () => "/dispatch" },
  chat: { href: () => "/chat" },
  payment: { href: () => "/finance" },
};

export function entityHref(entity: string, entityId: string | null | undefined): string | null {
  const e = ENTITY_HREF[entity];
  if (!e) return null;
  if (e.id && !entityId) return null;
  return e.href(entityId ?? "");
}

const ENTITY_LABELS: Record<string, string> = {
  load: "Load", truck: "Truck", trailer: "Trailer", driver: "Driver", customer: "Customer", invoice: "Invoice", user: "User",
  team: "Team", company: "Company", workOrder: "Work order", work_order: "Work order", claim: "Claim", document: "Document",
  announcement: "Announcement", system: "System", payment: "Payment", board: "Board", chat: "Chat", setting: "Setting",
};
export const entityLabel = (e: string) => ENTITY_LABELS[e] ?? e.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Action verb → tone. Anything unknown is neutral. */
const ACTION_TONE: Record<string, Tone> = {
  create: "ok", upload: "ok", assign: "info", update: "info", team: "info", status: "progress", board_status: "progress", recover: "progress",
  delete: "danger", void: "danger", hold: "warn", release: "ok", note: "neutral", login: "neutral", change_password: "neutral",
  link_telegram: "ok", link_telegram_group: "ok", unlink_telegram: "warn", unlink_telegram_group: "warn", telegram_webhook: "info",
  pay: "ok", send: "info",
};
export const actionTone = (a: string): Tone => ACTION_TONE[a] ?? "neutral";
export const actionLabel = (a: string) => a.replace(/_/g, " ");
