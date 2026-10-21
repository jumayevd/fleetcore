import { requireUser } from "@/lib/auth";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_STATUSES } from "@/lib/constants";
import { toDateInput, toLocalInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { saveWorkOrderChecked } from "../../_lib/actions";
import { str, workOrderFormOptions } from "../../_lib/data";
import { IN_HOUSE_VENDOR } from "../../_lib/shared";
import { WorkOrderForm } from "../../_components/work-order-form";

export const metadata = { title: "New work order" };

export default async function NewWorkOrder({ searchParams }: PageProps<"/maintenance/work-orders/new">) {
  await requireUser("fleet.edit");
  const sp = await searchParams;
  const { trucks, trailers, vendors } = await workOrderFormOptions();
  const truckId = str(sp.truck);
  const trailerId = str(sp.trailer);
  const category = str(sp.category);
  const statusParam = str(sp.status);
  const status = statusParam && (WORK_ORDER_STATUSES as readonly string[]).includes(statusParam) ? statusParam : "OPEN";
  const truck = trucks.find((t) => t.id === truckId);
  const trailer = trailers.find((t) => t.id === trailerId);
  const isPm = category === "PM";
  const logging = status === "DONE";
  // Defaults are computed here, in the zone the action parses dates in, so the client render can't disagree.
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Fleet · Maintenance · Work orders"
        title={isPm && truck ? `PM service for ${truck.unitNumber}` : logging ? "Log a completed repair" : "New work order"}
        subtitle={truck ? `${truck.unitNumber} · ${truck.detail}` : trailer ? `${trailer.unitNumber} · ${trailer.detail}` : undefined}
      />
      <WorkOrderForm
        action={saveWorkOrderChecked.bind(null, null)}
        trucks={trucks}
        trailers={trailers}
        vendors={vendors}
        now={toLocalInput(now)}
        submitLabel={logging ? "Log repair" : "Create work order"}
        cancelHref={truck && isPm ? "/maintenance?tab=pm" : logging ? "/maintenance?tab=log" : "/maintenance/work-orders"}
        initial={{
          truckId: truck?.id ?? null,
          trailerId: !truck && trailer ? trailer.id : null,
          category: category && (WORK_ORDER_CATEGORIES as readonly string[]).includes(category) ? category : "OTHER",
          status,
          title: isPm ? "PM service" : null,
          vendor: IN_HOUSE_VENDOR,
          scheduledAt: toDateInput(now),
          outAt: logging ? toLocalInput(now) : null,
          odometerKm: truck?.odometerKm ?? null,
        }}
      />
    </>
  );
}
