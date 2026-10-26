import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { Badge, PageHeader } from "@/components/ui";
import { deleteRepair, saveWorkOrder } from "@/app/actions/repairs";
import { DeleteButton } from "@/components/delete-button";
import { SYSTEM_FOR_TYPE, repairStatusLabel, repairStatusTone } from "@/components/shop/shared";
import { workOrderFormOptions } from "../../../_lib/data";
import { workOrderHref, workOrdersHref } from "../../../_lib/links";
import { vendorOptions } from "../../../_lib/repairs";
import { RepairForm } from "../../../_components/repair-form";

export async function generateMetadata({ params }: PageProps<"/maintenance/work-orders/[id]/edit">) {
  if (!(await getCurrentUser())) return {};
  const wo = await db.workOrder.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: wo ? `Edit ${roLabel(wo.number)}` : "Not found" };
}

export default async function EditRepair({ params }: PageProps<"/maintenance/work-orders/[id]/edit">) {
  const user = await requireUser("fleet.edit");
  const { id } = await params;
  const [wo, options, vendors, f] = await Promise.all([
    db.workOrder.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, truck: { select: { unitNumber: true } }, trailer: { select: { unitNumber: true } } } }),
    workOrderFormOptions(),
    vendorOptions(),
    getFormat(),
  ]);
  if (!wo) notFound();
  // A void order is kept as it was.
  if (wo.voidedAt || wo.status === "CANCELLED") redirect(workOrderHref(id));
  const unit = wo.truck?.unitNumber ?? wo.trailer?.unitNumber;
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return (
    <>
      <PageHeader
        title={<><span className="num text-fg-muted">{roLabel(wo.number)}</span> {wo.title}</>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge value={wo.status} tone={repairStatusTone(wo)} label={repairStatusLabel(wo)} dot />{unit && <span className="num">{unit}</span>}</span>}
        actions={
          <DeleteButton action={deleteRepair.bind(null, id)} redirectTo={workOrdersHref({})}
            confirm={`Delete ${roLabel(wo.number)} for good? Its lines, history and files go with it.${wo.status === "IN_PROGRESS" ? ` ${unit ?? "The unit"} goes back in service.` : ""}${wo.status === "DONE" ? " Service dates it already moved on the truck stay as they are." : ""} This can't be undone.`} />
        }
      />
      <RepairForm
        action={saveWorkOrder.bind(null, id)}
        trucks={options.trucks}
        trailers={options.trailers}
        drivers={options.drivers}
        vendors={vendors}
        money={can(user.role, "money.view")}
        savedStatus={wo.status}
        now={f.dateTimeInput(new Date())}
        submitLabel="Save changes"
        cancelHref={workOrderHref(id)}
        initial={{
          truckId: wo.truckId, trailerId: wo.trailerId,
          repairType: wo.repairType, title: wo.title, description: wo.description, technician: wo.technician, status: wo.status,
          scheduledAt: f.dateInput(wo.scheduledAt), inAt: f.dateTimeInput(wo.inAt), outAt: f.dateTimeInput(wo.outAt), promisedAt: f.dateInput(wo.promisedAt),
          stamps: { scheduledAt: iso(wo.scheduledAt), inAt: iso(wo.inAt), outAt: iso(wo.outAt), promisedAt: iso(wo.promisedAt) },
          vendorId: wo.vendorId, vendorName: wo.vendorId ? null : wo.vendor,
          payer: wo.payer, chargeDriverId: wo.chargeDriverId,
          // A completed order from before lines were kept starts with one line: its title and recorded cost.
          lines: wo.lines.length || wo.status !== "DONE"
            ? wo.lines.map((l) => ({ system: l.system, work: l.work, amount: l.amount }))
            : [{ system: SYSTEM_FOR_TYPE[wo.repairType] ?? "OTHER", work: wo.title, amount: wo.cost }],
          invoiceTotal: wo.invoiceTotal ?? (wo.status === "DONE" && wo.cost ? wo.cost : null), invoiceNumber: wo.invoiceNumber, paymentStatus: wo.paymentStatus,
          odometerKm: wo.odometerKm, odometerOutKm: wo.odometerOutKm,
        }}
      />
    </>
  );
}
