import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { defectLabel } from "@/lib/service";
import { PTI_COMPONENT_LABELS, REPAIR_TYPES, humanize } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { saveWorkOrder } from "@/app/actions/repairs";
import { repairTypeForCategory, repairTypeLabel } from "@/components/shop/shared";
import { str, workOrderFormOptions } from "../../_lib/data";
import { vendorOptions } from "../../_lib/repairs";
import { RepairForm } from "../../_components/repair-form";

export const metadata = { title: "New repair" };

/** Walk-around components → the repair type a fix usually is. */
const TYPE_FOR_COMPONENT: Record<string, string> = {
  STEER_TIRES: "TIRES", DRIVE_TIRES: "TIRES", TRAILER_TIRES: "TIRES", LIGHTS: "ELECTRICAL", BATTERY: "ELECTRICAL",
  SUSPENSION: "STEER", BODY: "BODY", GLASS_MIRRORS: "BODY", LEAKS: "ENGINE", BELTS_HOSES: "ENGINE",
};

/**
 * New repair. Prefills from the URL: `truck` / `trailer`, `type` (or an older `category`), `status` (IN_PROGRESS /
 * DONE), `vendor`, and `defect` (unit, title and description from the defect; saving ties the defect to the repair).
 */
export default async function NewRepair({ searchParams }: PageProps<"/maintenance/work-orders/new">) {
  const user = await requireUser("fleet.edit");
  const money = can(user.role, "money.view");
  const sp = await searchParams;
  const defectId = str(sp.defect);
  const [{ trucks, trailers, drivers }, vendors, f, defect] = await Promise.all([
    workOrderFormOptions(), vendorOptions(), getFormat(),
    defectId ? db.defect.findUnique({ where: { id: defectId }, select: { id: true, number: true, truckId: true, trailerId: true, component: true, description: true, status: true } }) : null,
  ]);
  const truck = trucks.find((t) => t.id === (defect?.truckId ?? str(sp.truck)));
  const trailer = trailers.find((t) => t.id === (defect?.trailerId ?? str(sp.trailer)));
  const typeParam = str(sp.type);
  const category = str(sp.category);
  const repairType = typeParam && (REPAIR_TYPES as readonly string[]).includes(typeParam) ? typeParam
    : defect ? TYPE_FOR_COMPONENT[defect.component] ?? "REPAIR"
      : category ? repairTypeForCategory(category) : "REPAIR";
  const statusParam = str(sp.status);
  const status = statusParam === "DONE" || statusParam === "IN_PROGRESS" ? statusParam : "OPEN";
  const vendorId = vendors.find((v) => v.id === str(sp.vendor))?.id ?? null;
  const now = new Date();
  const unit = truck ?? trailer;
  const component = defect ? PTI_COMPONENT_LABELS[defect.component] ?? humanize(defect.component) : null;
  const title = defect ? `Repair for ${defectLabel(defect.number)}`
    : status === "DONE" ? "Log a completed repair"
      : repairType !== "REPAIR" && unit ? `${repairTypeLabel(repairType)} for ${unit.unitNumber}` : "New repair";

  return (
    <>
      <PageHeader title={title}
        subtitle={defect ? `${component}: ${defect.description}${unit ? ` · ${unit.unitNumber}` : ""}` : unit ? `${unit.unitNumber} · ${unit.detail}` : "Book a unit into a shop, put it in now, or log work that is already done."} />
      <RepairForm
        action={saveWorkOrder.bind(null, null)}
        trucks={trucks}
        trailers={trailers}
        drivers={drivers}
        vendors={vendors}
        money={money}
        now={f.dateTimeInput(now)}
        submitLabel={status === "DONE" ? "Log repair" : "Create repair"}
        cancelHref={truck ? `/fleet/${truck.id}` : trailer ? `/fleet/trailers/${trailer.id}` : "/maintenance/work-orders"}
        initial={{
          truckId: truck?.id ?? null,
          trailerId: !truck && trailer ? trailer.id : null,
          repairType, status, vendorId,
          title: defect ? `${component}: ${defect.description}`.slice(0, 200) : null,
          description: defect ? `From ${defectLabel(defect.number)}: ${defect.description}` : null,
          defectId: defect && defect.status !== "CLOSED" ? defect.id : null,
          scheduledAt: f.dateInput(now),
          inAt: status !== "OPEN" ? f.dateTimeInput(now) : null,
          outAt: status === "DONE" ? f.dateTimeInput(now) : null,
          odometerKm: truck?.odometerKm ?? null,
          payer: "COMPANY",
        }}
      />
    </>
  );
}
