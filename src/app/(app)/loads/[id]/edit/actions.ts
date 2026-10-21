"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { routeKm } from "@/lib/geo";

/**
 * Save the editable parts of an in-transit or completed load (commercial, cargo, pricing, notes).
 *
 * Stops and the unit are locked for these loads (Arrive / Complete and Recover handle them), so unlike saveLoad this
 * never re-validates the truck, driver or trailer — on a delivered load they are usually on another job by now, and
 * re-checking them made history uneditable — and never rewrites pickup / delivery times from the stops.
 * Invoiced loads are refused: their money already lives on the invoice.
 */
export async function saveLoadDetails(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("loads.edit");
  const res = await attempt(async () => {
    const f = fields(fd);
    const existing = await db.load.findUnique({
      where: { id: loadId },
      include: { stops: { orderBy: { seq: "asc" }, select: { lat: true, lng: true } }, driver: { select: { payPerKm: true, teamId: true } } },
    });
    if (!existing) throw new FormError("This load no longer exists");
    if (existing.status === "INVOICED") throw new FormError("This load is invoiced — change the amounts on its invoice in Finance instead");
    if (existing.status === "PLANNED" || existing.status === "ASSIGNED") throw new FormError("This load was re-opened — reload the page to edit its stops and unit");

    const customerId = f.req("customerId", "Customer");
    const brokerId = f.str("brokerId");
    if (brokerId === customerId) throw new FormError("Broker and customer can't be the same company");
    const distanceKm = f.num("distanceKm") ?? (existing.stops.length >= 2 ? routeKm(existing.stops) : existing.distanceKm);

    await db.load.update({
      where: { id: loadId },
      data: {
        customerId,
        brokerId,
        customerRef: f.str("customerRef"),
        teamId: f.str("teamId") ?? existing.driver?.teamId ?? null,
        priority: f.str("priority") ?? "NORMAL",
        distanceKm,
        emptyKm: f.num("emptyKm") ?? 0,
        commodity: f.req("commodity", "Commodity"),
        weightKg: f.num("weightKg") ?? 0,
        pallets: f.num("pallets"),
        equipment: f.str("equipment") ?? "DRY_VAN",
        temperatureC: f.num("temperatureC"),
        hazmat: f.bool("hazmat"),
        rate: f.num("rate") ?? 0,
        driverPay: f.num("driverPay") ?? (existing.driver ? Math.round(distanceKm * existing.driver.payPerKm) : 0),
        fuelCost: f.num("fuelCost") ?? Math.round(distanceKm * 0.3),
        otherCost: f.num("otherCost") ?? 0,
        notes: f.str("notes"),
      },
    });
    await db.loadEvent.create({ data: { loadId, type: "EDIT", message: "Load details updated", userId: me.id } });
    await audit(me.id, "update", "load", loadId, existing.reference);
  });
  if (res?.error) return res;
  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  revalidatePath("/dispatch");
  redirect(`/loads/${loadId}`);
}
