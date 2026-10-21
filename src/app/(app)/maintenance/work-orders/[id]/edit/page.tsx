import { notFound } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDateInput, toLocalInput } from "@/lib/format";
import { Badge, InfoTip, PageHeader } from "@/components/ui";
import { saveWorkOrderChecked } from "../../../_lib/actions";
import { workOrderFormOptions } from "../../../_lib/data";
import { workOrderHref } from "../../../_lib/links";
import { WorkOrderForm } from "../../../_components/work-order-form";

export async function generateMetadata({ params }: PageProps<"/maintenance/work-orders/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const wo = await db.workOrder.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: wo ? `Edit work order #${wo.number}` : "Not found" };
}

export default async function EditWorkOrder({ params }: PageProps<"/maintenance/work-orders/[id]/edit">) {
  await requireUser("fleet.edit");
  const { id } = await params;
  const [wo, options] = await Promise.all([
    db.workOrder.findUnique({ where: { id }, include: { truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    workOrderFormOptions(),
  ]);
  if (!wo) notFound();
  const unit = wo.truck?.unitNumber ?? wo.trailer?.unitNumber;
  // Only starting and completing go through the shop and PM side effects from this form; cancelling a job in
  // progress is the Cancel button's move (it releases the unit), so the form doesn't offer it.
  const effects = wo.status === "IN_PROGRESS"
    ? "Completing it here releases the unit, like the Complete button. To stop without finishing, use Cancel on the work order."
    : "Starting or completing it here has the same effect on the unit and its PM schedule as the buttons.";

  return (
    <>
      <PageHeader
        eyebrow={<>Work order <span className="num">#{wo.number}</span></>}
        title={`Edit · ${wo.title}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge value={wo.status} dot />{unit && <span className="num">{unit}</span>}<InfoTip>{effects}</InfoTip></span>}
      />
      <WorkOrderForm
        action={saveWorkOrderChecked.bind(null, id)}
        trucks={options.trucks}
        trailers={options.trailers}
        vendors={options.vendors}
        savedStatus={wo.status}
        now={toLocalInput(new Date())}
        submitLabel="Save changes"
        cancelHref={workOrderHref(id)}
        initial={{
          truckId: wo.truckId, trailerId: wo.trailerId,
          title: wo.title, description: wo.description, category: wo.category, priority: wo.priority, status: wo.status, vendor: wo.vendor,
          scheduledAt: toDateInput(wo.scheduledAt), inAt: toLocalInput(wo.inAt), outAt: toLocalInput(wo.outAt),
          stamps: { scheduledAt: wo.scheduledAt.toISOString(), inAt: wo.inAt?.toISOString() ?? null, outAt: wo.outAt?.toISOString() ?? null },
          odometerKm: wo.odometerKm, laborCost: wo.laborCost, partsCost: wo.partsCost, cost: wo.cost, notes: wo.notes,
        }}
      />
    </>
  );
}
