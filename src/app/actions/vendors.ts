"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { VENDOR_TYPES } from "@/lib/constants";
import { looksLikeAddress, type VendorOption } from "@/components/shop/shared";

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
    if (vendorId) {
      const prev = await db.vendor.findUnique({ where: { id: vendorId }, select: { name: true } });
      if (!prev) throw new FormError("This vendor no longer exists.");
      await db.vendor.update({ where: { id: vendorId }, data });
      if (prev.name !== name) await db.workOrder.updateMany({ where: { vendorId }, data: { vendor: name } });
      await audit(me.id, "update", "vendor", vendorId, name);
    } else {
      const v = await db.vendor.create({ data });
      id = v.id;
      await audit(me.id, "create", "vendor", v.id, name);
    }
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
