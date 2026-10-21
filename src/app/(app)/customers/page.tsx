import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Building2, Handshake, Receipt, AlertTriangle, BadgeDollarSign } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CUSTOMER_KIND_LABELS } from "@/lib/constants";
import { daysAgo, money, number } from "@/lib/format";
import { Card, Cell, Chip, EmptyState, InfoTip, LinkButton, PageHeader, Progress, Segmented, Stat, Table, cn } from "@/components/ui";
import { LinkRow } from "../drivers/link-row";
import { CustomerSearch } from "./filters";
import { ACTIVE_LOAD_STATUSES, BROKER_KINDS, COMPLETED_LOAD_STATUSES, KIND_FILTERS, KIND_SHORT, KIND_TONE, SHIPPER_KINDS, creditTone, grossInvoice, type KindFilter } from "./shared";

export const metadata = { title: "Customers & brokers" };

/** Rows rendered at most; the footer says when a filter matches more. */
const LIMIT = 200;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Open (sent, unpaid) invoices summed per account. Grouped by tax rate too, so the gross total stays exact. */
type ArGroup = { customerId: string; taxRate: number; _sum: { amount: number | null }; _count: number };
function sumGross(groups: ArGroup[]) {
  const m = new Map<string, { amount: number; count: number }>();
  for (const g of groups) {
    const r = m.get(g.customerId) ?? { amount: 0, count: 0 };
    r.amount += grossInvoice({ amount: g._sum.amount ?? 0, taxRate: g.taxRate });
    r.count += g._count;
    m.set(g.customerId, r);
  }
  return m;
}

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requireUser("customers.view");
  const editable = can(user.role, "customers.edit");
  const sp = await searchParams;
  const kindParam = str(sp.kind)?.toUpperCase();
  const kind: KindFilter = kindParam && (KIND_FILTERS as readonly string[]).includes(kindParam) ? (kindParam as KindFilter) : "ALL";
  const q = str(sp.q) ?? "";
  const since = daysAgo(90);
  const now = new Date();

  // Filtering happens in the database; only the rows on screen are loaded.
  const text = { contains: q, mode: "insensitive" as const };
  const where: Prisma.CustomerWhereInput = {
    AND: [
      kind === "SHIPPER" ? { kind: { in: SHIPPER_KINDS } } : kind === "BROKER" ? { kind: { in: BROKER_KINDS } } : {},
      q ? { OR: [{ name: text }, { contactName: text }, { email: text }, { phone: text }, { city: text }, { country: text }, { taxId: text }] } : {},
    ],
  };
  const completed90 = { status: { in: [...COMPLETED_LOAD_STATUSES] }, deliveredAt: { gte: since } };

  const [customers, matched, kinds, delivered90, brokeredTotal90, arGroups, overdueGroups, limits] = await Promise.all([
    db.customer.findMany({ where, orderBy: { name: "asc" }, take: LIMIT }),
    db.customer.count({ where }),
    // KPIs are book-wide, not affected by the filter.
    db.customer.groupBy({ by: ["kind"], _count: true }),
    db.load.aggregate({ where: completed90, _sum: { rate: true }, _count: true }), // every load has exactly one customer, so this is the unique total
    db.load.aggregate({ where: { ...completed90, brokerId: { not: null } }, _sum: { rate: true } }),
    db.invoice.groupBy({ by: ["customerId", "taxRate"], where: { status: "SENT" }, _sum: { amount: true }, _count: true }),
    db.invoice.groupBy({ by: ["customerId", "taxRate"], where: { status: "SENT", dueAt: { lt: now } }, _sum: { amount: true }, _count: true }),
    db.customer.findMany({ where: { creditLimit: { gt: 0 }, invoices: { some: { status: "SENT" } } }, select: { id: true, creditLimit: true } }),
  ]);

  // 90-day figures and active loads, for the accounts on screen only.
  const ids = customers.map((c) => c.id);
  const [revAsCustomer, revAsBroker, activeAsCustomer, activeAsBroker] = await Promise.all([
    db.load.groupBy({ by: ["customerId"], where: { ...completed90, customerId: { in: ids } }, _sum: { rate: true }, _count: true }),
    db.load.groupBy({ by: ["brokerId"], where: { ...completed90, brokerId: { in: ids } }, _sum: { rate: true }, _count: true }),
    db.load.groupBy({ by: ["customerId"], where: { status: { in: [...ACTIVE_LOAD_STATUSES] }, customerId: { in: ids } }, _count: true }),
    db.load.groupBy({ by: ["brokerId"], where: { status: { in: [...ACTIVE_LOAD_STATUSES] }, brokerId: { in: ids } }, _count: true }),
  ]);

  const arBy = sumGross(arGroups);
  const overdueBy = sumGross(overdueGroups);
  type Row = { revCustomer: number; revBroker: number; loads90: number; active: number };
  const stats = new Map<string, Row>();
  const row = (id: string) => { let r = stats.get(id); if (!r) { r = { revCustomer: 0, revBroker: 0, loads90: 0, active: 0 }; stats.set(id, r); } return r; };
  for (const g of revAsCustomer) { const r = row(g.customerId); r.revCustomer += g._sum.rate ?? 0; r.loads90 += g._count; }
  for (const g of revAsBroker) { const r = row(g.brokerId!); r.revBroker += g._sum.rate ?? 0; r.loads90 += g._count; }
  for (const g of activeAsCustomer) row(g.customerId).active += g._count;
  for (const g of activeAsBroker) row(g.brokerId!).active += g._count;

  const countKinds = (list: string[]) => kinds.reduce((a, g) => a + (list.includes(g.kind) ? g._count : 0), 0);
  const total = kinds.reduce((a, g) => a + g._count, 0);
  const shippers = countKinds(SHIPPER_KINDS);
  const brokers = countKinds(BROKER_KINDS);
  const revenue90 = delivered90._sum.rate ?? 0;
  const loads90 = delivered90._count;
  const brokered90 = brokeredTotal90._sum.rate ?? 0;
  const totalOf = (m: Map<string, { amount: number; count: number }>) => [...m.values()].reduce((a, r) => ({ amount: a.amount + r.amount, count: a.count + r.count }), { amount: 0, count: 0 });
  const { amount: openAr, count: openCount } = totalOf(arBy);
  const { amount: overdue, count: overdueCount } = totalOf(overdueBy);
  const overLimit = limits.filter((c) => (arBy.get(c.id)?.amount ?? 0) >= c.creditLimit * 0.9).length;

  const href = (k: KindFilter) => { const p = new URLSearchParams(); if (k !== "ALL") p.set("kind", k); if (q) p.set("q", q); const s = p.toString(); return `/customers${s ? `?${s}` : ""}`; };
  const filtered = kind !== "ALL" || Boolean(q);

  return (
    <>
      <PageHeader
        eyebrow="People & partners"
        title="Customers & brokers"
        actions={editable && <LinkButton href="/customers/new"><Plus />Add customer</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Link href={href("SHIPPER")} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Stat className="h-full transition-colors group-hover:border-line-strong" label="Customers" value={shippers} hint="shippers we haul for" icon={<Building2 />} />
        </Link>
        <Link href={href("BROKER")} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Stat className="h-full transition-colors group-hover:border-line-strong" label="Brokers" value={brokers} hint={brokered90 ? `${money(brokered90)} brokered in 90d` : "no brokered loads in 90d"} icon={<Handshake />} />
        </Link>
        <Stat label="Revenue (90d)" value={money(revenue90)} hint={loads90 ? `${number(loads90)} loads delivered · ${money(Math.round(revenue90 / loads90))} per load` : "no deliveries yet"} icon={<BadgeDollarSign />} />
        <Stat label="Open A/R" value={money(openAr)} hint={`${openCount} invoices sent, unpaid${overLimit ? ` · ${overLimit} near credit limit` : ""}`} tone={overLimit ? "warn" : "neutral"} icon={<Receipt />} />
        <Stat label="Overdue" value={money(overdue)} hint={overdue ? `${overdueCount} past due date` : "nothing past due"} tone={overdue ? "danger" : "ok"} icon={<AlertTriangle />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented active={kind} items={[
            { key: "ALL", label: "All", href: href("ALL"), count: total },
            { key: "SHIPPER", label: "Shippers", href: href("SHIPPER"), count: shippers },
            { key: "BROKER", label: "Brokers", href: href("BROKER"), count: brokers },
          ]} />
          <CustomerSearch q={q} kind={kind} />
        </div>
        <p className="num text-[12px] text-fg-subtle">
          {matched > customers.length ? <>First {customers.length} of {number(matched)}</> : <>{customers.length} of {number(total)}</>}
        </p>
      </div>

      <Card flush>
        <Table head={["Name", "Contact", "City", "Active loads", "Loads (90d)",
          <span key="rev" className="inline-flex items-center gap-1">Revenue (90d)<InfoTip>Delivered loads by delivery date. A broker is credited for the loads it tendered; hover a figure for the broker share.</InfoTip></span>,
          <span key="ar" className="inline-flex items-center gap-1">Open A/R<InfoTip>Sent, unpaid invoices including tax.</InfoTip></span>,
          <span key="cr" className="inline-flex items-center gap-1">Credit used<InfoTip>Open A/R as a share of the credit limit; hover for the limit.</InfoTip></span>,
          "Terms"]}>
          {customers.map((c) => {
            const s = stats.get(c.id);
            const ar = arBy.get(c.id);
            const late = overdueBy.get(c.id);
            const rev = (s?.revCustomer ?? 0) + (s?.revBroker ?? 0);
            const ratio = c.creditLimit > 0 ? (ar?.amount ?? 0) / c.creditLimit : 0;
            const tone = creditTone(ratio);
            return (
              <LinkRow key={c.id} href={`/customers/${c.id}`}>
                <td className="min-w-56">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/customers/${c.id}`} title={c.taxId ? `INN ${c.taxId}` : undefined} className="truncate font-medium text-fg hover:underline">{c.name}</Link>
                    <Chip tone={KIND_TONE[c.kind]} title={CUSTOMER_KIND_LABELS[c.kind] ?? c.kind} className="normal-case tracking-normal">{KIND_SHORT[c.kind] ?? c.kind}</Chip>
                  </div>
                </td>
                <td className="max-w-48">
                  {c.contactName || c.phone
                    ? <Cell primary={<span title={c.email ?? undefined}>{c.contactName ?? <span className="text-fg-faint">—</span>}</span>} secondary={c.phone ? <a href={`tel:${c.phone}`} className="num hover:underline">{c.phone}</a> : undefined} />
                    : <span className="text-fg-faint">—</span>}
                </td>
                <td className="whitespace-nowrap">{c.city ? <span title={c.country ?? undefined}>{c.city}</span> : <span className="text-fg-faint">—</span>}</td>
                <td className="num">{s?.active ? s.active : <span className="text-fg-faint">—</span>}</td>
                <td className="num">{s?.loads90 ? s.loads90 : <span className="text-fg-faint">—</span>}</td>
                <td>
                  {rev
                    ? <span className="num" title={s?.revBroker ? `${money(s.revBroker)} as broker` : undefined}>{money(rev)}</span>
                    : <span className="text-fg-faint">—</span>}
                </td>
                <td>
                  {ar?.amount
                    ? <Cell mono primary={money(ar.amount)} secondary={late?.amount ? <span className="text-danger">{money(late.amount)} overdue · {late.count}</span> : undefined} />
                    : <span className="text-fg-faint">—</span>}
                </td>
                <td className="min-w-28">
                  <div className="flex items-center gap-2" title={`${money(ar?.amount ?? 0)} of ${money(c.creditLimit)}`}>
                    <Progress value={ratio} tone={tone} className="w-14" />
                    <span className={cn("num text-[12px]", tone === "danger" ? "font-medium text-danger" : tone === "warn" ? "text-warn" : "text-fg-muted")}>{Math.round(ratio * 100)}%</span>
                  </div>
                </td>
                <td className="num whitespace-nowrap text-fg-muted">Net {c.paymentTerms}</td>
              </LinkRow>
            );
          })}
        </Table>
        {customers.length === 0 && (
          total === 0
            ? <EmptyState title="No customers yet" description="Add the shippers you haul for and the brokers who tender you loads." action={editable && <LinkButton href="/customers/new"><Plus />Add customer</LinkButton>} />
            : <EmptyState title="No matches" description={filtered ? "Try the other kind, or clear the search." : "Nothing to show."} action={<LinkButton href="/customers" variant="secondary">Clear filters</LinkButton>} />
        )}
        {matched > customers.length && (
          <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">
            Showing the first <span className="num">{customers.length}</span> of <span className="num">{number(matched)}</span> by name. Search by name, contact, city or tax ID to find the rest.
          </p>
        )}
      </Card>
    </>
  );
}
