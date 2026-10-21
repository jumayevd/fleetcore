import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel } from "@/lib/service";
import { VENDOR_TYPE_LABELS } from "@/lib/constants";
import { Card, Chip, DL, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { Bars } from "@/components/charts-lite";
import { ActionButton } from "@/components/shop/action-button";
import { RepairStatus, RepairTags } from "@/components/shop/repair-bits";
import { downtime, durationText, linesSummary, repairTypeLabel } from "@/components/shop/shared";
import { setVendorActive } from "@/app/actions/vendors";
import { newWorkOrderHref, workOrderHref, workOrdersHref } from "@/app/(app)/maintenance/_lib/links";
import { plural } from "@/app/(app)/maintenance/_lib/shared";
import { UnitLink } from "@/app/(app)/maintenance/_components/unit-link";

export async function generateMetadata({ params }: PageProps<"/vendors/[id]">) {
  if (!(await getCurrentUser())) return {};
  const v = await db.vendor.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: v?.name ?? "Not found" };
}

const YEAR = 365 * 86_400_000;
const SHOWN = 100;

export default async function VendorPage({ params }: PageProps<"/vendors/[id]">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const { id } = await params;
  const vendor = await db.vendor.findUnique({ where: { id } });
  if (!vendor) notFound();
  const now = new Date().getTime();
  const liveWhere = { vendorId: id, voidedAt: null, status: { not: "CANCELLED" } };
  const doneWhere = { vendorId: id, status: "DONE" };
  const [repairs, total, liveCount, openCount, all, year, timedRows, typeRows, lastAt] = await Promise.all([
    db.workOrder.findMany({
      where: { vendorId: id }, orderBy: { scheduledAt: "desc" }, take: SHOWN,
      include: { truck: { select: { id: true, unitNumber: true } }, trailer: { select: { id: true, unitNumber: true } }, lines: { orderBy: { position: "asc" }, select: { system: true, work: true } } },
    }),
    db.workOrder.count({ where: { vendorId: id } }),
    db.workOrder.count({ where: liveWhere }),
    db.workOrder.count({ where: { vendorId: id, voidedAt: null, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } } }),
    db.workOrder.aggregate({ where: doneWhere, _sum: { cost: true }, _count: { _all: true } }),
    db.workOrder.aggregate({ where: { ...doneWhere, completedAt: { gte: new Date(now - YEAR) } }, _sum: { cost: true }, _count: { _all: true } }),
    db.workOrder.findMany({ where: { ...doneWhere, inAt: { not: null }, outAt: { not: null } }, select: { inAt: true, outAt: true, status: true } }),
    db.workOrder.groupBy({ by: ["repairType"], where: doneWhere, _sum: { cost: true }, _count: { _all: true } }),
    db.workOrder.aggregate({ where: liveWhere, _max: { scheduledAt: true, completedAt: true } }),
  ]);
  const spendYear = year._sum.cost ?? 0;
  const spendAll = all._sum.cost ?? 0;
  const doneCount = all._count._all;
  const timed = timedRows.map((w) => downtime(w)).filter((d): d is NonNullable<typeof d> => d != null);
  const avgShop = timed.length ? timed.reduce((a, d) => a + d.ms, 0) / timed.length : null;
  const lastMs = Math.max(lastAt._max.completedAt?.getTime() ?? 0, lastAt._max.scheduledAt?.getTime() ?? 0);
  const last = lastMs ? new Date(lastMs) : null;
  const types = typeRows.map((t) => ({ t: t.repairType, count: t._count._all, cost: t._sum.cost ?? 0 })).sort((a, b) => (money ? b.cost - a.cost : b.count - a.count));

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{VENDOR_TYPE_LABELS[vendor.type] ?? vendor.type}{vendor.city && <span>· {vendor.city}</span>}{!vendor.active && <Chip>Inactive</Chip>}</span>}
        actions={editable && (
          <>
            <LinkButton href={`/vendors/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>
            {vendor.active && <LinkButton href={newWorkOrderHref({ vendor: id })}><Plus />New repair here</LinkButton>}
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Repairs" value={f.number(liveCount)} hint={total > liveCount ? `${total - liveCount} void not counted` : "every repair at this shop"} />
        <Stat label="Open now" value={openCount} tone={openCount ? "info" : "neutral"} hint="scheduled or in the shop" />
        {money && <Stat label="Spend, 12 months" value={f.money(spendYear)} hint={`${plural(year._count._all, "completed repair")} · ${f.money(spendAll)} in all`} />}
        {money && <Stat label="Average per repair" value={doneCount ? f.money(spendAll / doneCount) : "—"} hint="completed repairs" />}
        <Stat label="Average time in the shop" value={avgShop != null ? durationText(avgShop) : "—"} hint="from going in to back in service" />
        {!money && <Stat label="Last used" value={last ? f.date(last) : "Never"} />}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Repairs here" flush
            actions={total > 0 && <Link href={workOrdersHref({ shop: id, status: "all" })} className="text-[12px] font-medium text-fg-muted hover:text-fg">All in Repairs</Link>}>
            <Table head={["Repair", "Unit", "Work", "Status", "Date", ...(money ? ["Cost"] : [])]} empty={repairs.length === 0}
              emptyTitle="No repairs here yet" emptyDescription={editable ? "Pick this shop on a repair, or use New repair here." : "Repairs sent to this shop will be listed here."}>
              {repairs.map((w) => {
                const summary = linesSummary(w.lines);
                return (
                  <tr key={w.id} className={w.voidedAt ? "opacity-60" : undefined}>
                    <td className="whitespace-nowrap"><Link href={workOrderHref(w.id)} className="num font-medium text-fg hover:underline">{roLabel(w.number)}</Link></td>
                    <td><UnitLink truck={w.truck} trailer={w.trailer} /></td>
                    <td className="max-w-80">
                      <Link href={workOrderHref(w.id)} className="block truncate hover:underline" title={summary || w.title}>{w.title}</Link>
                      {summary && <p className="truncate text-[11px] text-fg-subtle">{summary}</p>}
                      <RepairTags w={w} className="mt-1" />
                    </td>
                    <td><RepairStatus w={w} now={now} /></td>
                    <td className="num whitespace-nowrap text-fg-muted">{f.date(w.completedAt ?? w.scheduledAt)}</td>
                    {money && <td className="num whitespace-nowrap">{w.cost && !w.voidedAt ? f.money(w.cost) : <span className="text-fg-faint">—</span>}</td>}
                  </tr>
                );
              })}
            </Table>
            {total > SHOWN && <p className="border-t border-line px-4 py-2 text-[12px] text-fg-subtle">Showing the newest {SHOWN} of {f.number(total)}.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Contact">
            <DL cols={1} items={[
              ["Contact person", vendor.contactName ?? "—"],
              ["Phone", vendor.phone ? <a key="p" href={`tel:${vendor.phone}`} className="num hover:underline">{vendor.phone}</a> : "—"],
              ["Email", vendor.email ? <a key="e" href={`mailto:${vendor.email}`} className="hover:underline">{vendor.email}</a> : "—"],
              ["Address", vendor.address ?? "—"],
              ["City", vendor.city ?? "—"],
              ["Last used", last ? f.date(last) : "Never"],
            ]} />
            {vendor.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-[13px] text-fg-muted">{vendor.notes}</p>}
          </Card>

          {types.length > 0 && (
            <Card title={money ? "Spend by repair type" : "Repairs by type"}>
              <Bars data={types.map((t) => ({ label: repairTypeLabel(t.t), value: money ? t.cost : t.count, hint: money ? `${plural(t.count, "repair")} · ${f.money(t.cost)}` : plural(t.count, "repair") }))}
                format={money ? f.money : "number"} labelWidth={130} valueWidth={money ? 72 : 32} />
            </Card>
          )}

          {editable && (
            <Card title="Status">
              <p className="mb-2 text-[12px] text-fg-muted">{vendor.active ? "Offered when someone picks a shop." : "Not offered for new repairs. Its history stays."}</p>
              <ActionButton action={setVendorActive.bind(null, id, !vendor.active)} showOk
                confirm={vendor.active ? `Stop offering ${vendor.name} for new repairs?` : undefined}>
                {vendor.active ? "Stop offering it" : "Offer it again"}
              </ActionButton>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
