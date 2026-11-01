"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { VENDOR_TYPES } from "@/lib/constants";
import { looksLikeAddress, type VendorOption } from "@/components/shop/shared";
import { geocodeMissingVendors, geocodeVendor } from "@/lib/geocode";

/*
 * Vendors: shops, dealers, tire and road-side services. Repair orders point at a vendor (vendorId) and keep its name
 * in `vendor` too, so older reports that group by name keep adding up; renaming a vendor renames it on its orders.
 */

const pick = { id: true, name: true, type: true, city: true, phone: true, active: true } as const;

function refreshVendors(id?: string | null) {
  revalidatePath("/vendors");
  if (id) revalidatePath(`/vendors/${id}`);
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
}

const findByName = (name: string, notId?: string | null) =>
  db.vendor.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" }, ...(notId ? { id: { not: notId } } : {}) }, select: pick });

/** Add / edit vendor form. Opens the vendor when saved. */
export async function saveVendor(vendorId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  let id = vendorId;
  const res = await attempt(async () => {
    const f = fields(fd);
    const name = f.req("name", "Name").replace(/\s+/g, " ").slice(0, 120);
    const type = f.str("type") ?? "SHOP";
    if (!(VENDOR_TYPES as readonly string[]).includes(type)) throw new FormError("Pick a vendor type");
    const email = f.str("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FormError("That email address doesn't look right");
    const clash = await findByName(name, vendorId);
    if (clash) throw new FormError(`There is already a vendor called ${clash.name}`);
    const data = {
      name, type, phone: f.str("phone"), email, contactName: f.str("contactName"), address: f.str("address"), city: f.str("city"),
      notes: f.str("notes"), active: vendorId ? f.bool("active") : true,
    };
    let moved = true;
    if (vendorId) {
      const prev = await db.vendor.findUnique({ where: { id: vendorId }, select: { name: true, address: true, city: true } });
      if (!prev) throw new FormError("This vendor no longer exists.");
      moved = prev.address !== data.address || prev.city !== data.city;
      await db.vendor.update({ where: { id: vendorId }, data });
      if (prev.name !== name) await db.workOrder.updateMany({ where: { vendorId }, data: { vendor: name } });
      await audit(me.id, "update", "vendor", vendorId, name);
    } else {
      const v = await db.vendor.create({ data });
      id = v.id;
      await audit(me.id, "create", "vendor", v.id, name);
    }
    // Where it is, for "Vendors near this truck": looked up again whenever the address or city changes.
    if (moved && id) await geocodeVendor({ id, address: data.address, city: data.city }).catch(() => null);
  });
  if (res?.error) return res;
  refreshVendors(id);
  redirect(`/vendors/${id}`);
}

/**
 * "Create vendor" from inside the vendor picker (no page change). A vendor with the same name is returned instead of
 * making a second one.
 */
export async function createVendorInline(input: { name: string; type?: string; phone?: string; city?: string }): Promise<{ error?: string; vendor?: VendorOption; existed?: boolean }> {
  const me = await requireUser("fleet.edit");
  const name = (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { error: "Give the vendor a name" };
  const type = input.type && (VENDOR_TYPES as readonly string[]).includes(input.type) ? input.type : "SHOP";
  const existing = await findByName(name);
  if (existing) return { vendor: existing, existed: true };
  const v = await db.vendor.create({
    data: { name, type, phone: input.phone?.trim() || null, city: input.city?.trim() || null, address: looksLikeAddress(name) ? name : null },
    select: pick,
  });
  await audit(me.id, "create", "vendor", v.id, name);
  refreshVendors(v.id);
  return { vendor: v };
}

/** Clean-up: point every order that typed `name` (and has no vendor) at `vendorId`. */
export async function linkVendorName(name: string, vendorId: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } });
    if (!vendor) throw new FormError("That vendor no longer exists. Reload the page.");
    const { count } = await db.workOrder.updateMany({
      where: { vendorId: null, vendor: { equals: name, mode: "insensitive" } },
      data: { vendorId: vendor.id, vendor: vendor.name },
    });
    await audit(me.id, "link", "vendor", vendor.id, `${count} orders typed "${name}" → ${vendor.name}`);
    refreshVendors(vendor.id);
    return { ok: count ? `${count} ${count === 1 ? "order" : "orders"} linked to ${vendor.name}` : "Nothing left to link" };
  });
}

/** Clean-up: make a vendor out of a typed shop name and link its orders. */
export async function createVendorFromName(name: string): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean) throw new FormError("There is no name to create a vendor from");
    const vendor = (await findByName(clean)) ?? (await db.vendor.create({
      data: { name: clean, type: "SHOP", address: looksLikeAddress(clean) ? clean : null },
      select: pick,
    }));
    const { count } = await db.workOrder.updateMany({
      where: { vendorId: null, vendor: { equals: name, mode: "insensitive" } },
      data: { vendorId: vendor.id, vendor: vendor.name },
    });
    await audit(me.id, "create", "vendor", vendor.id, `${vendor.name} from ${count} typed orders`);
    refreshVendors(vendor.id);
    return { ok: `${vendor.name} added with ${count} ${count === 1 ? "order" : "orders"}` };
  });
}

export type NearVendor = {
  id: string; name: string; type: string; phone: string | null; address: string | null; city: string | null;
  /** Straight-line distance from the truck's last position; null when the truck or the vendor has no location. */
  distanceKm: number | null;
  /** How the vendor was placed: its street address, or only its city. */
  precision: "ADDRESS" | "CITY" | null;
  /** Repair orders with this vendor: all of them, and on this truck. */
  visits: number; truckVisits: number; lastVisit: string | null;
};
export type VendorsNearResult = {
  error?: string;
  truck?: { unitNumber: string; locationName: string | null; at: string | null; source: string | null; located: boolean };
  vendors?: NearVendor[];
};

const toRad = (d: number) => (d * Math.PI) / 180;
const greatCircleKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const s = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
};

/**
 * "Vendors near this truck" on the repair form: every active vendor with how far it is from the truck's last position
 * (ELD / tracker, as the crow flies) and how often the company used it, overall and on this truck. Vendors never
 * placed on the map are looked up first, a few at a time (src/lib/geocode.ts).
 */
export async function vendorsNear(truckId: string): Promise<VendorsNearResult> {
  await requireUser("fleet.view");
  const truck = await db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true, lat: true, lng: true, locationName: true, lastPingAt: true, pingSource: true } });
  if (!truck) return { error: "That truck no longer exists. Pick another one." };
  await geocodeMissingVendors().catch(() => 0);
  const [vendors, all, onTruck] = await Promise.all([
    db.vendor.findMany({ where: { active: true }, select: { id: true, name: true, type: true, phone: true, address: true, city: true, lat: true, lng: true, geoPrecision: true } }),
    db.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, voidedAt: null }, _count: true, _max: { scheduledAt: true } }),
    db.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, voidedAt: null, truckId }, _count: true }),
  ]);
  const visits = new Map(all.map((r) => [r.vendorId!, r]));
  const truckVisits = new Map(onTruck.map((r) => [r.vendorId!, r._count]));
  const here = truck.lat != null && truck.lng != null ? { lat: truck.lat, lng: truck.lng } : null;
  return {
    truck: { unitNumber: truck.unitNumber, locationName: truck.locationName, at: truck.lastPingAt?.toISOString() ?? null, source: truck.pingSource, located: Boolean(here) },
    vendors: vendors.map((v): NearVendor => ({
      id: v.id, name: v.name, type: v.type, phone: v.phone, address: v.address, city: v.city,
      distanceKm: here && v.lat != null && v.lng != null ? greatCircleKm(here, { lat: v.lat, lng: v.lng }) : null,
      precision: v.lat != null && (v.geoPrecision === "ADDRESS" || v.geoPrecision === "CITY") ? v.geoPrecision : null,
      visits: visits.get(v.id)?._count ?? 0, truckVisits: truckVisits.get(v.id) ?? 0,
      lastVisit: visits.get(v.id)?._max.scheduledAt?.toISOString() ?? null,
    })),
  };
}

/** Stop offering a vendor in the picker (its history stays), or bring it back. */
export async function setVendorActive(id: string, active: boolean): Promise<ActionState> {
  const me = await requireUser("fleet.edit");
  return attempt(async () => {
    const v = await db.vendor.findUnique({ where: { id }, select: { name: true } });
    if (!v) throw new FormError("This vendor no longer exists. Reload the page.");
    await db.vendor.update({ where: { id }, data: { active } });
    await audit(me.id, active ? "activate" : "deactivate", "vendor", id, v.name);
    refreshVendors(id);
    return { ok: active ? `${v.name} is active again` : `${v.name} is no longer offered for new repairs` };
  });
}
