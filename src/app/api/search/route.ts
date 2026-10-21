import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { LOAD_STATUS_LABELS, type LoadStatus } from "@/lib/constants";

export const dynamic = "force-dynamic";

export type SearchHit = { id: string; title: string; subtitle?: string; href: string; badge?: string; mono?: boolean };
export type SearchGroup = { label: string; hits: SearchHit[] };

/** Global search for the command palette. Permission-filtered, 5 hits per entity. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });
  const like = { contains: q, mode: "insensitive" as const };
  const groups: SearchGroup[] = [];

  const [loads, drivers, trucks, trailers, customers, invoices] = await Promise.all([
    can(user.role, "loads.view")
      ? db.load.findMany({
          where: { OR: [{ reference: like }, { originCity: like }, { destCity: like }, { commodity: like }, { customer: { name: like } }] },
          take: 5, orderBy: { pickupAt: "desc" }, include: { customer: { select: { name: true } } },
        })
      : [],
    can(user.role, "drivers.view")
      ? db.driver.findMany({ where: { OR: [{ name: like }, { phone: like }, { licenseNumber: like }] }, take: 5, include: { truck: { select: { unitNumber: true } } } })
      : [],
    can(user.role, "fleet.view")
      ? db.truck.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }, { make: like }, { model: like }, { vin: like }] }, take: 5 })
      : [],
    can(user.role, "fleet.view") ? db.trailer.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }] }, take: 5 }) : [],
    can(user.role, "customers.view") ? db.customer.findMany({ where: { OR: [{ name: like }, { contactName: like }, { city: like }] }, take: 5 }) : [],
    can(user.role, "finance.view")
      ? db.invoice.findMany({ where: { OR: [{ number: like }, { customer: { name: like } }] }, take: 5, include: { customer: { select: { name: true } } } })
      : [],
  ]);

  if (loads.length) groups.push({ label: "Loads", hits: loads.map((l) => ({ id: l.id, title: l.reference, mono: true, subtitle: `${l.originCity} → ${l.destCity} · ${l.customer.name}`, badge: LOAD_STATUS_LABELS[l.status as LoadStatus] ?? l.status, href: `/loads/${l.id}` })) });
  if (drivers.length) groups.push({ label: "Drivers", hits: drivers.map((d) => ({ id: d.id, title: d.name, subtitle: [d.truck?.unitNumber, d.phone].filter(Boolean).join(" · "), badge: d.status, href: `/drivers/${d.id}` })) });
  if (trucks.length) groups.push({ label: "Trucks", hits: trucks.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: `${t.make} ${t.model} · ${t.plate}`, badge: t.status, href: `/fleet/${t.id}` })) });
  if (trailers.length) groups.push({ label: "Trailers", hits: trailers.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: t.type, badge: t.status, href: `/fleet/trailers/${t.id}` })) });
  if (customers.length) groups.push({ label: "Customers", hits: customers.map((c) => ({ id: c.id, title: c.name, subtitle: [c.contactName, c.city].filter(Boolean).join(" · "), href: `/customers/${c.id}` })) });
  if (invoices.length) groups.push({ label: "Invoices", hits: invoices.map((i) => ({ id: i.id, title: i.number, mono: true, subtitle: i.customer.name, badge: i.status, href: `/finance/invoices/${i.id}` })) });

  return NextResponse.json({ groups });
}
