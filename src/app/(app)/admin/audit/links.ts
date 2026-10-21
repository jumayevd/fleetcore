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
  repair: { href: (id) => `/maintenance/work-orders/${id}`, id: true },
  vendor: { href: (id) => (id ? `/vendors/${id}` : "/vendors") },
  truck_type: { href: () => "/maintenance/oil" },
  truckType: { href: () => "/maintenance/oil" },
  walk_around: { href: () => "/inspections" },
  walkAround: { href: () => "/inspections" },
  defect: { href: (id) => (id ? `/inspections/defects?defect=${id}` : "/inspections/defects") },
  roadside: { href: (id) => (id ? `/inspections/roadside/${id}` : "/inspections/roadside") },
  roadside_inspection: { href: (id) => (id ? `/inspections/roadside/${id}` : "/inspections/roadside") },
};

export function entityHref(entity: string, entityId: string | null | undefined): string | null {
  const e = ENTITY_HREF[entity];
  if (!e) return null;
  if (e.id && !entityId) return null;
  return e.href(entityId ?? "");
}

const ENTITY_LABELS: Record<string, string> = {
  truck: "Truck", trailer: "Trailer", driver: "Driver", user: "Account", member: "Member", company: "Company",
  workOrder: "Repair", work_order: "Repair", repair: "Repair", document: "Document", setting: "Setting", fuel: "Fuel",
  vendor: "Vendor", truck_type: "Truck type", truckType: "Truck type", walk_around: "Walk-around", walkAround: "Walk-around",
  defect: "Defect", roadside: "Roadside inspection", roadside_inspection: "Roadside inspection",
};
export const entityLabel = (e: string) => ENTITY_LABELS[e] ?? e.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Action verb → tone. Anything unknown is neutral. */
const ACTION_TONE: Record<string, Tone> = {
  create: "ok", upload: "ok", assign: "info", update: "info", status: "progress", readings: "info",
  delete: "danger", remove: "danger", hold: "warn", release: "ok", note: "neutral", login: "neutral", change_password: "neutral",
  invite: "info", revoke_invite: "warn", join: "ok", leave: "warn", role: "progress",
  review: "info", stage: "progress", close: "ok", confirm: "ok", reopen: "warn", void: "danger", driver_informed: "info", invoice: "info",
};
export const actionTone = (a: string): Tone => ACTION_TONE[a] ?? "neutral";
export const actionLabel = (a: string) => a.replace(/_/g, " ");
