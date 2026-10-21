import type { Tone } from "@/components/ui";

/**
 * Where an audit entry's entity lives. `id: true` means the link needs the entity id (a detail
 * page); the others link to a list page even when the id is missing.
 */
const ENTITY_HREF: Record<string, { href: (id: string) => string; id?: true }> = {
  truck: { href: (id) => `/fleet/${id}`, id: true },
  trailer: { href: (id) => (id ? `/fleet/trailers/${id}` : "/fleet/trailers") },
  driver: { href: (id) => `/drivers/${id}`, id: true },
  company: { href: () => "/admin/company" },
  member: { href: () => "/admin/members" },
  workOrder: { href: (id) => `/maintenance/work-orders/${id}`, id: true },
  work_order: { href: (id) => `/maintenance/work-orders/${id}`, id: true },
};

export function entityHref(entity: string, entityId: string | null | undefined): string | null {
  const e = ENTITY_HREF[entity];
  if (!e) return null;
  if (e.id && !entityId) return null;
  return e.href(entityId ?? "");
}

const ENTITY_LABELS: Record<string, string> = {
  truck: "Truck", trailer: "Trailer", driver: "Driver", user: "Account", member: "Member", company: "Company",
  workOrder: "Work order", work_order: "Work order", document: "Document", setting: "Setting", fuel: "Fuel",
};
export const entityLabel = (e: string) => ENTITY_LABELS[e] ?? e.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Action verb → tone. Anything unknown is neutral. */
const ACTION_TONE: Record<string, Tone> = {
  create: "ok", upload: "ok", assign: "info", update: "info", status: "progress", readings: "info",
  delete: "danger", remove: "danger", hold: "warn", release: "ok", note: "neutral", login: "neutral", change_password: "neutral",
  invite: "info", revoke_invite: "warn", join: "ok", leave: "warn", role: "progress",
};
export const actionTone = (a: string): Tone => ACTION_TONE[a] ?? "neutral";
export const actionLabel = (a: string) => a.replace(/_/g, " ");
