import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFormat } from "@/lib/format-server";
import { defectLabel, roLabel } from "@/lib/service";
import {
  DEFECT_STATUS_LABELS, PTI_COMPONENT_LABELS, REPAIR_STAGE_LABELS, REPAIR_TYPE_LABELS, ROADSIDE_RESULT_LABELS, TRAILER_STATUS_LABELS,
  VENDOR_TYPE_LABELS, humanize,
} from "@/lib/constants";

export const dynamic = "force-dynamic";

export type SearchHit = { id: string; title: string; subtitle?: string; href: string; badge?: string; mono?: boolean };
export type SearchGroup = { label: string; hits: SearchHit[] };

/**
 * Global search for the command palette, inside the active company only. Permission-filtered, 5 hits per entity.
 * Record numbers work as people say them: "RO-137", "ro137", "#137", "137" find repair order 137; "DEF-21" a defect.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ groups: [] });
  const like = { contains: q, mode: "insensitive" as const };
  const ro = /^(?:ro-?|#)?\s*(\d+)$/i.exec(q);
  const def = /^(?:def-?|#)?\s*(\d+)$/i.exec(q);
  const roNumber = ro ? Number(ro[1]) : null;
  const defNumber = def ? Number(def[1]) : null;
  // "RO-12" / "DEF-12" ask for that record only ("Road Runner Tire" is still a word search).
  const explicitDefect = /^def-?\s*\d+$/i.test(q);
  const explicitRo = /^ro-?\s*\d+$/i.test(q);
  const groups: SearchGroup[] = [];
  const fleet = can(user.role, "fleet.view");
  const f = await getFormat();

  const [trucks, trailers, drivers, workOrders, vendors, defects, roadside] = await Promise.all([
    fleet && !explicitRo && !explicitDefect
      ? db.truck.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }, { make: like }, { model: like }, { vin: like }, { group: like }, { homeTerminal: like }] }, take: 5, orderBy: { unitNumber: "asc" }, include: { driver: { select: { name: true } } } })
      : [],
    fleet && !explicitRo && !explicitDefect
      ? db.trailer.findMany({ where: { OR: [{ unitNumber: like }, { plate: like }, { locationName: like }] }, take: 5, orderBy: { unitNumber: "asc" } })
      : [],
    can(user.role, "drivers.view") && !explicitRo && !explicitDefect
      ? db.driver.findMany({ where: { OR: [{ name: like }, { phone: like }, { licenseNumber: like }, { email: like }, { dispatcher: like }] }, take: 5, include: { truck: { select: { unitNumber: true } } }, orderBy: { name: "asc" } })
      : [],
    fleet && !explicitDefect
      ? db.workOrder.findMany({
          where: {
            OR: [
              ...(explicitRo ? [] : [{ title: like }, { vendor: like }, { invoiceNumber: like }, { technician: like }, { vendorRef: { name: like } }]),
              ...(roNumber != null ? [{ number: roNumber }] : []),
            ],
          },
          take: 5, orderBy: { scheduledAt: "desc" },
          include: { truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } }, vendorRef: { select: { name: true } } },
        })
      : [],
    fleet && !explicitRo && !explicitDefect
      ? db.vendor.findMany({ where: { OR: [{ name: like }, { city: like }, { contactName: like }, { phone: like }] }, take: 5, orderBy: { name: "asc" } })
      : [],
    fleet && !explicitRo
      ? db.defect.findMany({
          where: { OR: [...(explicitDefect ? [] : [{ description: like }]), ...(defNumber != null ? [{ number: defNumber }] : [])] },
          take: 5, orderBy: { foundAt: "desc" },
          include: { truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } },
        })
      : [],
    fleet && !explicitRo && !explicitDefect
      ? db.roadsideInspection.findMany({
          where: { OR: [{ reportNumber: like }, { location: like }, { state: like }, { driver: { name: like } }] },
          take: 5, orderBy: { inspectedAt: "desc" },
          include: { driver: { select: { name: true } }, truck: { select: { unitNumber: true } }, _count: { select: { violations: true } } },
        })
      : [],
  ]);

  if (trucks.length) groups.push({
    label: "Trucks",
    hits: trucks.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: [`${t.make} ${t.model}`, t.plate, t.driver?.name].filter(Boolean).join(" · "), badge: humanize(t.status), href: `/fleet/${t.id}` })),
  });
  if (trailers.length) groups.push({ label: "Trailers", hits: trailers.map((t) => ({ id: t.id, title: t.unitNumber, mono: true, subtitle: [humanize(t.type), t.locationName].filter(Boolean).join(" · "), badge: TRAILER_STATUS_LABELS[t.status] ?? t.status, href: `/fleet/trailers/${t.id}` })) });
  if (drivers.length) groups.push({ label: "Drivers", hits: drivers.map((d) => ({ id: d.id, title: d.name, subtitle: [d.truck?.unitNumber, d.phone, d.dispatcher && `dispatch: ${d.dispatcher}`].filter(Boolean).join(" · "), badge: humanize(d.status), href: `/drivers/${d.id}` })) });
  if (workOrders.length) groups.push({
    label: "Repairs",
    hits: workOrders.map((w) => ({
      id: w.id, title: `${roLabel(w.number)} ${w.title}`,
      subtitle: [w.truck?.unitNumber ?? w.trailer?.unitNumber, REPAIR_TYPE_LABELS[w.repairType] ?? humanize(w.repairType), w.vendorRef?.name ?? w.vendor, f.day(w.scheduledAt)].filter(Boolean).join(" · "),
      badge: w.voidedAt ? "Void" : w.status === "IN_PROGRESS" && w.stage ? (REPAIR_STAGE_LABELS[w.stage] ?? humanize(w.stage)) : humanize(w.status),
      href: `/maintenance/work-orders/${w.id}`,
    })),
  });
  if (vendors.length) groups.push({ label: "Vendors", hits: vendors.map((v) => ({ id: v.id, title: v.name, subtitle: [VENDOR_TYPE_LABELS[v.type] ?? humanize(v.type), v.city, v.phone].filter(Boolean).join(" · "), badge: v.active ? undefined : "Inactive", href: `/vendors/${v.id}` })) });
  if (defects.length) groups.push({
    label: "Defects",
    hits: defects.map((d) => ({
      id: d.id, title: `${defectLabel(d.number)} ${PTI_COMPONENT_LABELS[d.component] ?? humanize(d.component)}`,
      subtitle: [d.truck?.unitNumber ?? d.trailer?.unitNumber, d.description, d.holdsUnit && d.status !== "CLOSED" ? "holding the unit" : null].filter(Boolean).join(" · "),
      badge: DEFECT_STATUS_LABELS[d.status] ?? d.status, href: `/inspections/defects?defect=${d.id}`,
    })),
  });
  if (roadside.length) groups.push({
    label: "Roadside inspections",
    hits: roadside.map((r) => ({
      id: r.id, title: r.reportNumber ? `Report ${r.reportNumber}` : `Inspection ${f.day(r.inspectedAt)}`, mono: Boolean(r.reportNumber),
      subtitle: [f.date(r.inspectedAt), r.driver?.name, r.truck?.unitNumber, [r.location, r.state].filter(Boolean).join(", "), r._count.violations ? `${r._count.violations} violation${r._count.violations === 1 ? "" : "s"}` : null].filter(Boolean).join(" · "),
      badge: ROADSIDE_RESULT_LABELS[r.result] ?? r.result, href: `/inspections/roadside/${r.id}`,
    })),
  });

  return NextResponse.json({ groups });
}
