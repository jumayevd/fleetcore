import { format } from "date-fns";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BILLING_STAGE_LABELS, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, type BillingStage, type LoadStatus } from "@/lib/constants";
import { LIST_INCLUDE, loadWhere, parseLoadFilters } from "../query";
import { ratePerKm } from "../shared";

/** CSV of the loads list with the same URL filters as /loads (money columns only for finance / dispatch roles). */
export async function GET(req: Request) {
  const user = await requireUser("loads.view");
  const showMoney = can(user.role, "finance.view") || can(user.role, "loads.edit");
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseLoadFilters({ ...sp, view: "table" });
  const loads = await db.load.findMany({ where: loadWhere(f), orderBy: { pickupAt: "desc" }, take: 5000, include: LIST_INCLUDE });

  const ts = (d: Date | null | undefined) => (d ? format(d, "yyyy-MM-dd HH:mm") : "");
  const head = [
    "Reference", "Status", "Billing stage", "Customer", "Broker", "Customer ref", "Team", "Priority", "Hazmat",
    "Origin", "Destination", "Stops", "Pickup", "Delivery window", "Delivered at", "Driver", "Truck", "Trailer",
    "Loaded km", "Empty km", ...(showMoney ? ["Rate", "Driver pay", "Fuel", "Other", "Margin", "Rate per km"] : []),
    "Commodity", "Equipment", "Weight kg", "Pallets",
  ];
  const rows = loads.map((l) => [
    l.reference, LOAD_STATUS_LABELS[l.status as LoadStatus] ?? l.status, l.billingStage === "NONE" ? "" : BILLING_STAGE_LABELS[l.billingStage as BillingStage],
    l.customer.name, l.broker?.name ?? "", l.customerRef ?? "", l.team?.name ?? "", l.priority, l.hazmat ? "yes" : "no",
    `${l.originName} (${l.originCity})`, `${l.destName} (${l.destCity})`, l._count.stops, ts(l.pickupAt), ts(l.deliveryAt), ts(l.deliveredAt),
    l.driver?.name ?? "", l.truck?.unitNumber ?? "", l.trailer?.unitNumber ?? "",
    Math.round(l.distanceKm), Math.round(l.emptyKm),
    ...(showMoney ? [l.rate, l.driverPay, l.fuelCost, l.otherCost, l.rate - l.driverPay - l.fuelCost - l.otherCost, (ratePerKm(l.rate, l.distanceKm, l.emptyKm) ?? 0).toFixed(2)] : []),
    l.commodity, EQUIPMENT_LABELS[l.equipment] ?? l.equipment, Math.round(l.weightKg), l.pallets ?? "",
  ]);
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    // Free text (references, commodity, stop names) must not run as a spreadsheet formula: a leading =, +, @, tab or
    // CR, or a "-" that doesn't start a number, gets an apostrophe. Numeric cells (negative margins too) pass through.
    if (typeof v === "string" && (/^[=+@\t\r]/.test(s) || /^-(?![\d.])/.test(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loads-${format(new Date(), "yyyy-MM-dd")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
