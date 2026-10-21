import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { TRAILER_STATUS_LABELS, WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";

export const dynamic = "force-dynamic";

export type SearchHit = { id: string; title: string; subtitle?: string; href: string; badge?: string; mono?: boolean };
export type SearchGroup = { label: string; hits: SearchHit[] };

/** Global search for the command palette, inside the active company only. Permission-filtered, 5 hits per entity. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });
  const like = { contains: q, mode: "insensitive" as const };
  const asNumber = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
  const groups: SearchGroup[] = [];
  const fleet = can(user.role, "fleet.view");

  const [trucks, trailers, drivers, workOrders] = await Promise.all([
    fleet ? db.truck.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }, { make: like }, { model: like }, { vin: like }, { group: like }] }, take: 5, orderBy: { unitNumber: "asc" } }) : [],
    fleet ? db.trailer.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }, { locationName: like }] }, take: 5, orderBy: { unitNumber: "asc" } }) : [],
    can(user.role, "drivers.view")
      ? db.driver.findMany({ where: { OR: [{ name: like }, { phone: like }, { licenseNumber: like }, { email: like }] }, take: 5, include: { truck: { select: { unitNumber: true } } }, orderBy: { name: "asc" } })
      : [],
    fleet
      ? db.workOrder.findMany({
          where: { OR: [{ title: like }, { vendor: like }, ...(asNumber != null ? [{ number: asNumber }] : [])] },
          take: 5, orderBy: { scheduledAt: "desc" }, include: { truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } },
        })
      : [],
  ]);

  if (trucks.length) groups.push({ label: "Trucks", hits: trucks.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: `${t.make} ${t.model} · ${t.plate}`, badge: humanize(t.status), href: `/fleet/${t.id}` })) });
  if (trailers.length) groups.push({ label: "Trailers", hits: trailers.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: [humanize(t.type), t.locationName].filter(Boolean).join(" · "), badge: TRAILER_STATUS_LABELS[t.status] ?? t.status, href: `/fleet/trailers/${t.id}` })) });
  if (drivers.length) groups.push({ label: "Drivers", hits: drivers.map((d) => ({ id: d.id, title: d.name, subtitle: [d.truck?.unitNumber, d.phone].filter(Boolean).join(" · "), badge: humanize(d.status), href: `/drivers/${d.id}` })) });
  if (workOrders.length) groups.push({
    label: "Work orders",
    hits: workOrders.map((w) => ({
      id: w.id, title: `#${w.number} ${w.title}`,
      subtitle: [w.truck?.unitNumber ?? w.trailer?.unitNumber, WORK_ORDER_CATEGORY_LABELS[w.category], w.vendor].filter(Boolean).join(" · "),
      badge: humanize(w.status), href: `/maintenance/work-orders/${w.id}`,
    })),
  });

  return NextResponse.json({ groups });
}
