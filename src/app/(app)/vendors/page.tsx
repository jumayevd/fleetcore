import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { VENDOR_TYPES, VENDOR_TYPE_LABELS } from "@/lib/constants";
import { Card, Chip, FilterPills, InfoTip, LinkButton, PageHeader, Table } from "@/components/ui";
import { ActionButton } from "@/components/shop/action-button";
import { looksLikeAddress, vendorKey } from "@/components/shop/shared";
import { createVendorFromName, linkVendorName } from "@/app/actions/vendors";
import { str } from "@/app/(app)/maintenance/_lib/data";
import { vendorHref, vendorsHref, workOrdersHref } from "@/app/(app)/maintenance/_lib/links";
import { plural } from "@/app/(app)/maintenance/_lib/shared";
import { FilterBar } from "@/app/(app)/maintenance/_components/filter-bar";
import { SearchBox } from "@/app/(app)/maintenance/_components/search-box";

export const metadata = { title: "Vendors" };

const YEAR = 365 * 86_400_000;
const TIDY_SHOWN = 8;

export default async function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const sp = await searchParams;
  const q = str(sp.q);
  const type = str(sp.type);
  const validType = type && (VENDOR_TYPES as readonly string[]).includes(type) ? type : undefined;
  const statusParam = str(sp.status);
  const status = statusParam === "inactive" || statusParam === "all" ? statusParam : "active";
  const tidyAll = str(sp.tidy) === "1";
  const since = new Date(new Date().getTime() - YEAR);

  const [vendors, used, spent, year, typed] = await Promise.all([
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, voidedAt: null, status: { not: "CANCELLED" } }, _count: { _all: true }, _max: { scheduledAt: true, completedAt: true } }),
    db.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, status: "DONE" }, _sum: { cost: true } }),
    db.workOrder.groupBy({ by: ["vendorId"], where: { vendorId: { not: null }, status: "DONE", completedAt: { gte: since } }, _count: { _all: true }, _sum: { cost: true } }),
    db.workOrder.groupBy({ by: ["vendor"], where: { vendorId: null, vendor: { not: null }, status: { not: "CANCELLED" } }, _count: { _all: true }, _max: { scheduledAt: true } }),
  ]);
  const usedBy = new Map(used.map((u) => [u.vendorId, u]));
  const spentBy = new Map(spent.map((s) => [s.vendorId, s._sum.cost ?? 0]));
  const lastUsed = (id: string) => {
    const u = usedBy.get(id);
    const a = u?._max.completedAt?.getTime() ?? 0;
    const b = u?._max.scheduledAt?.getTime() ?? 0;
    return a || b ? new Date(Math.max(a, b)) : null;
  };

  const needle = q ? vendorKey(q) : "";
  const rows = vendors
    .filter((v) => (status === "all" ? true : status === "active" ? v.active : !v.active))
    .filter((v) => !validType || v.type === validType)
    .filter((v) => !needle || vendorKey([v.name, v.city, v.phone, v.contactName, v.address].filter(Boolean).join(" ")).includes(needle));
  const counts = { active: vendors.filter((v) => v.active).length, inactive: vendors.filter((v) => !v.active).length, all: vendors.length };
  const byName = new Map(vendors.map((v) => [vendorKey(v.name), v]));
  const named = (id: string | null) => vendors.find((v) => v.id === id);
  const mostUsed = [...year].sort((a, b) => b._count._all - a._count._all).slice(0, 3).flatMap((y) => { const v = named(y.vendorId); return v ? [{ v, n: y._count._all }] : []; });
  const mostSpent = [...year].sort((a, b) => (b._sum.cost ?? 0) - (a._sum.cost ?? 0)).filter((y) => (y._sum.cost ?? 0) > 0).slice(0, 3).flatMap((y) => { const v = named(y.vendorId); return v ? [{ v, n: y._sum.cost ?? 0 }] : []; });

  // Typed shop names on older orders: a vendor with the same (or containing) name to link to, else one to create.
  const tidy = typed
    .filter((t) => t.vendor)
    .map((t) => {
      const name = t.vendor!;
      const key = vendorKey(name);
      const match = byName.get(key) ?? vendors.find((v) => key.length >= 4 && (vendorKey(v.name).includes(key) || key.includes(vendorKey(v.name))));
      return { name, count: t._count._all, last: t._max.scheduledAt, match, address: looksLikeAddress(name) };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const tidyTotal = tidy.reduce((a, t) => a + t.count, 0);
  const keep = { q, type: validType, status: status === "active" ? undefined : status };

  return (
    <>
      <PageHeader title="Vendors" subtitle="Shops, dealers, tire and road-side services the fleet uses."
        actions={editable && <LinkButton href="/vendors/new"><Plus />Add vendor</LinkButton>} />

      {(mostUsed.length > 0 || mostSpent.length > 0) && (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <Card title={<span className="flex items-center gap-1.5">Most visited<InfoTip>Completed repairs in the last 12 months.</InfoTip></span>}>
            <ol className="space-y-1.5">
              {mostUsed.map(({ v, n }, i) => (
                <li key={v.id} className="flex items-center gap-2 text-[13px]">
                  <span className="num w-4 text-fg-faint">{i + 1}</span>
                  <Link href={vendorHref(v.id)} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline">{v.name}</Link>
                  <span className="num text-fg-muted">{plural(n, "repair")}</span>
                </li>
              ))}
            </ol>
          </Card>
          {money ? (
            <Card title={<span className="flex items-center gap-1.5">Most spent<InfoTip>Completed repairs in the last 12 months.</InfoTip></span>}>
              {mostSpent.length === 0 ? <p className="text-[12px] text-fg-muted">No spend recorded in the last 12 months.</p> : (
                <ol className="space-y-1.5">
                  {mostSpent.map(({ v, n }, i) => (
                    <li key={v.id} className="flex items-center gap-2 text-[13px]">
                      <span className="num w-4 text-fg-faint">{i + 1}</span>
                      <Link href={vendorHref(v.id)} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline">{v.name}</Link>
                      <span className="num font-medium text-fg">{f.money(n)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ) : (
            <Card title="Spend"><p className="text-[12px] text-fg-muted">Spend per vendor is shown to owners, admins and fleet specialists.</p></Card>
          )}
        </div>
      )}

      {tidy.length > 0 && (
        <Card className="mb-4" flush id="tidy"
          title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent-text" aria-hidden />{plural(tidy.length, "shop name")} typed on older repairs</span>}
          actions={<span className="num text-[11px] text-fg-subtle">{plural(tidyTotal, "repair")} not linked to a vendor</span>}>
          <p className="px-4 pb-2 text-[12px] text-fg-muted">Link each to a vendor so its repairs count towards that shop, or make it a vendor of its own.</p>
          <ul className="divide-y divide-line border-t border-line">
            {(tidyAll ? tidy : tidy.slice(0, TIDY_SHOWN)).map((t) => (
              <li key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                <Link href={workOrdersHref({ shop: `t:${t.name}`, status: "all" })} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline">{t.name}</Link>
                {t.address && <Chip tone="warn" title="Looks like a street address. Create the vendor, then give it the shop's name.">Address only</Chip>}
                <span className="num text-[12px] text-fg-muted">{plural(t.count, "repair")}{t.last ? ` · last ${f.date(t.last)}` : ""}</span>
                {editable && (t.match
                  ? <ActionButton action={linkVendorName.bind(null, t.name, t.match.id)} pendingText="Linking…">Link to {t.match.name}</ActionButton>
                  : <ActionButton action={createVendorFromName.bind(null, t.name)} pendingText="Creating…">Create vendor</ActionButton>)}
              </li>
            ))}
          </ul>
          {tidy.length > TIDY_SHOWN && !tidyAll && (
            <div className="border-t border-line px-4 py-2"><Link href={vendorsHref({ ...keep, tidy: 1 })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Show all {tidy.length}</Link></div>
          )}
        </Card>
      )}

      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <FilterPills active={status} items={[
            { key: "active", label: "Active", href: vendorsHref({ ...keep, status: undefined }), count: counts.active },
            { key: "inactive", label: "Inactive", href: vendorsHref({ ...keep, status: "inactive" }), count: counts.inactive },
            { key: "all", label: "All", href: vendorsHref({ ...keep, status: "all" }), count: counts.all },
          ]} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox action="/vendors" q={q} keep={keep} placeholder="Search name, city, phone" />
            <FilterBar align="right" keep={["status", "q"]} filters={[
              { name: "type", label: "Type", value: validType ?? "", options: VENDOR_TYPES.map((t) => ({ value: t, label: VENDOR_TYPE_LABELS[t] })) },
            ]} />
          </div>
        </div>
        <Table head={["Vendor", "Type", "Phone", "City", "Repairs", ...(money ? ["Total spend"] : []), "Last used", "Status"]} empty={rows.length === 0}
          emptyTitle={vendors.length ? "No vendor matches" : "No vendors yet"}
          emptyDescription={vendors.length ? "Clear the search or pick another filter." : editable ? "Add the shops you use, or create one from the repair form while picking a shop." : "Shops appear here as the team adds them."}>
          {rows.map((v) => {
            const n = usedBy.get(v.id)?._count._all ?? 0;
            const last = lastUsed(v.id);
            return (
              <tr key={v.id} className={v.active ? undefined : "text-fg-muted"}>
                <td className="max-w-72">
                  <Link href={vendorHref(v.id)} className="block truncate font-medium text-fg hover:underline">{v.name}</Link>
                  {v.contactName && <p className="truncate text-[11px] text-fg-subtle">{v.contactName}</p>}
                </td>
                <td className="whitespace-nowrap text-fg-muted">{VENDOR_TYPE_LABELS[v.type] ?? v.type}</td>
                <td className="whitespace-nowrap">{v.phone ? <a href={`tel:${v.phone}`} className="num text-fg-muted hover:text-fg hover:underline">{v.phone}</a> : <span className="text-fg-faint">—</span>}</td>
                <td className="max-w-40 truncate text-fg-muted">{v.city ?? <span className="text-fg-faint">—</span>}</td>
                <td className="num">{n ? <Link href={workOrdersHref({ shop: v.id, status: "all" })} className="hover:underline">{n}</Link> : <span className="text-fg-faint">0</span>}</td>
                {money && <td className="num font-medium">{spentBy.get(v.id) ? f.money(spentBy.get(v.id)) : <span className="font-normal text-fg-faint">—</span>}</td>}
                <td className="num whitespace-nowrap text-fg-muted">{last ? f.date(last) : <span className="text-fg-faint">Never</span>}</td>
                <td>{v.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
