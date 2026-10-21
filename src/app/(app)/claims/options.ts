import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CUSTOMER_KIND_LABELS, DRIVER_TYPE_LABELS, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, ROLE_LABELS, humanize, type LoadStatus, type Role } from "@/lib/constants";
import { date } from "@/lib/format";
import type { ClaimFormOptions, LoadOption, PersonOption } from "./shared";
export type { ClaimFormOptions } from "./shared";

type Current = Partial<{ loadId: string | null; driverId: string | null; truckId: string | null; trailerId: string | null; customerId: string | null; assignedToId: string | null }>;

/**
 * Caps on what is shipped to the client form (the comboboxes show 60 rows at a time and filter as
 * the user types). Anything the claim or a listed load points at is added on top of the cap.
 */
const CAP = { loads: 500, drivers: 300, trucks: 200, trailers: 200, customers: 300, staff: 100 } as const;

const LOAD_SELECT = {
  id: true, reference: true, status: true, originCity: true, destCity: true, destName: true, customerRef: true, pickupAt: true, deliveredAt: true,
  driverId: true, truckId: true, trailerId: true, customerId: true, brokerId: true,
  customer: { select: { name: true } }, broker: { select: { name: true } }, driver: { select: { name: true } }, truck: { select: { unitNumber: true } },
} satisfies Prisma.LoadSelect;
const DRIVER_SELECT = { id: true, name: true, type: true, status: true, phone: true, licenseNumber: true, truck: { select: { unitNumber: true } } } satisfies Prisma.DriverSelect;
const TRUCK_SELECT = { id: true, unitNumber: true, make: true, model: true, plate: true, status: true, driver: { select: { name: true } } } satisfies Prisma.TruckSelect;
const TRAILER_SELECT = { id: true, unitNumber: true, type: true, plate: true, status: true } satisfies Prisma.TrailerSelect;
const CUSTOMER_SELECT = { id: true, name: true, kind: true, city: true } satisfies Prisma.CustomerSelect;
const STAFF_SELECT = { id: true, name: true, role: true } satisfies Prisma.UserSelect;

/** Ids in `want` that `have` does not contain yet (deduplicated, nulls dropped). */
function missing(have: { id: string }[], want: (string | null | undefined)[]) {
  const got = new Set(have.map((x) => x.id));
  return [...new Set(want.filter((x): x is string => !!x && !got.has(x)))];
}

/** Capped list + the pinned rows it missed, in the list's order. */
async function withPinned<T extends { id: string }>(list: T[], want: (string | null | undefined)[], find: (ids: string[]) => Promise<T[]>, key: (x: T) => string) {
  const ids = missing(list, want);
  if (ids.length === 0) return list;
  return [...list, ...(await find(ids))].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: "base" }));
}

/** Active staff who can own a claim (drivers excluded), plus the current owner even if inactive. */
export async function staffOptions(currentId?: string | null): Promise<PersonOption[]> {
  const list = await db.user.findMany({ where: { active: true, role: { not: "DRIVER" } }, orderBy: { name: "asc" }, take: CAP.staff, select: STAFF_SELECT });
  const users = await withPinned(list, [currentId], (ids) => db.user.findMany({ where: { id: { in: ids } }, select: STAFF_SELECT }), (u) => u.name);
  return users.map((u) => ({ id: u.id, label: u.name, hint: ROLE_LABELS[u.role as Role] ?? u.role }));
}

/**
 * Searchable-select options for the claim form: recent loads (a year back), drivers who are not
 * inactive, units and customers — each capped (see CAP). Whatever the claim already points at, and
 * every driver, unit and customer on the listed loads, is always included, so an edit never loses a
 * reference to a retired unit and picking a load always resolves its driver, unit and customer.
 */
export async function claimFormOptions(current: Current = {}): Promise<ClaimFormOptions> {
  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const [recent, drivers0, trucks0, trailers0, customers0, assignees] = await Promise.all([
    db.load.findMany({
      where: { pickupAt: { gte: yearAgo }, status: { not: "CANCELLED" } },
      orderBy: { pickupAt: "desc" }, take: CAP.loads, select: LOAD_SELECT,
    }),
    db.driver.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { name: "asc" }, take: CAP.drivers, select: DRIVER_SELECT }),
    db.truck.findMany({ orderBy: { unitNumber: "asc" }, take: CAP.trucks, select: TRUCK_SELECT }),
    db.trailer.findMany({ orderBy: { unitNumber: "asc" }, take: CAP.trailers, select: TRAILER_SELECT }),
    db.customer.findMany({ orderBy: { name: "asc" }, take: CAP.customers, select: CUSTOMER_SELECT }),
    staffOptions(current.assignedToId),
  ]);
  // The claim's own load may be older than a year, cancelled or past the cap: list it anyway (last).
  const ownLoad = missing(recent, [current.loadId]);
  const loads = ownLoad.length ? [...recent, ...(await db.load.findMany({ where: { id: { in: ownLoad } }, select: LOAD_SELECT }))] : recent;

  const [drivers, trucks, trailers, customers] = await Promise.all([
    withPinned(drivers0, [current.driverId, ...loads.map((l) => l.driverId)], (ids) => db.driver.findMany({ where: { id: { in: ids } }, select: DRIVER_SELECT }), (d) => d.name),
    withPinned(trucks0, [current.truckId, ...loads.map((l) => l.truckId)], (ids) => db.truck.findMany({ where: { id: { in: ids } }, select: TRUCK_SELECT }), (t) => t.unitNumber),
    withPinned(trailers0, [current.trailerId, ...loads.map((l) => l.trailerId)], (ids) => db.trailer.findMany({ where: { id: { in: ids } }, select: TRAILER_SELECT }), (t) => t.unitNumber),
    withPinned(customers0, [current.customerId, ...loads.flatMap((l) => [l.customerId, l.brokerId])], (ids) => db.customer.findMany({ where: { id: { in: ids } }, select: CUSTOMER_SELECT }), (c) => c.name),
  ]);

  return {
    loads: loads.map((l): LoadOption => ({
      id: l.id,
      label: l.reference,
      hint: `${l.originCity} → ${l.destCity} · ${l.broker?.name ?? l.customer.name} · ${LOAD_STATUS_LABELS[l.status as LoadStatus] ?? humanize(l.status)} · ${date(l.pickupAt)}`,
      keywords: [l.customer.name, l.broker?.name, l.driver?.name, l.truck?.unitNumber, l.customerRef].filter(Boolean).join(" "),
      driverId: l.driverId, truckId: l.truckId, trailerId: l.trailerId, customerId: l.brokerId ?? l.customerId,
      place: `${l.destName}, ${l.destCity}`,
      deliveredAt: l.deliveredAt ? l.deliveredAt.toISOString() : null,
    })),
    drivers: drivers.map((d) => ({
      id: d.id, label: d.name,
      hint: [DRIVER_TYPE_LABELS[d.type] ?? d.type, d.truck?.unitNumber, d.status !== "ACTIVE" ? humanize(d.status).toLowerCase() : null].filter(Boolean).join(" · "),
      keywords: [d.phone, d.licenseNumber].filter(Boolean).join(" "),
    })),
    trucks: trucks.map((t) => ({
      id: t.id, label: t.unitNumber,
      hint: [`${t.make} ${t.model}`, t.plate, t.driver?.name, t.status !== "ACTIVE" ? humanize(t.status).toLowerCase() : null].filter(Boolean).join(" · "),
      keywords: [t.plate, t.driver?.name].filter(Boolean).join(" "),
    })),
    trailers: trailers.map((t) => ({
      id: t.id, label: t.unitNumber,
      hint: [EQUIPMENT_LABELS[t.type] ?? t.type, t.plate, humanize(t.status).toLowerCase()].filter(Boolean).join(" · "),
      keywords: t.plate ?? undefined,
    })),
    customers: customers.map((c) => ({
      id: c.id, label: c.name,
      hint: [CUSTOMER_KIND_LABELS[c.kind] ?? c.kind, c.city].filter(Boolean).join(" · "),
    })),
    assignees,
  };
}
