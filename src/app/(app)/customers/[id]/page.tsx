import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ListChecks, Pencil, Plus, Phone, Mail, MapPin } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { BILLING_STAGE_LABELS, CUSTOMER_KIND_LABELS, LOAD_STATUS_LABELS, type BillingStage, type LoadStatus } from "@/lib/constants";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { ago, date, dateTime, daysAgo, money, number } from "@/lib/format";
import { DocumentsPanel } from "@/components/documents/panel";
import { Badge, Card, Chip, DL, Disclosure, EmptyState, InfoTip, LinkButton, PageHeader, Progress, Stat, StatusDot, Table, Tabs, cardClass, cn, type Tone } from "@/components/ui";
import { onTimeTone } from "../../drivers/shared";
import { ACTIVE_LOAD_STATUSES, COMPLETED_LOAD_STATUSES, KIND_SHORT, KIND_TONE, creditTone, grossInvoice, isBroker, requiredCustomerDocs } from "../shared";

const TABS = ["loads", "invoices", "documents", "details"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { loads: "Loads", invoices: "Invoices", documents: "Documents", details: "Details" };
const DORMANT_DAYS = 90;

export async function generateMetadata({ params }: PageProps<"/customers/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.customer.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: r?.name ?? "Not found" };
}

export default async function CustomerDetail({ params, searchParams }: PageProps<"/customers/[id]">) {
  const user = await requireUser("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const finance = can(user.role, "finance.view");
  const editable = can(user.role, "customers.edit");
  const visibleTabs = TABS.filter((t) => t !== "invoices" || finance);
  const tab: Tab = (visibleTabs as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "loads";

  const c = await db.customer.findUnique({ where: { id }, include: { _count: { select: { loads: true, brokerLoads: true, invoices: true, documents: true } } } });
  if (!c) notFound();
  const broker = isBroker(c.kind);
  const party = { OR: [{ customerId: id }, { brokerId: id }] };
  const completed = { ...party, status: { in: [...COMPLETED_LOAD_STATUSES] } };

  // Lifetime and 90-day figures are aggregated in the database rather than loading every completed load.
  const [totals, totals90, onTime, active, openInvoices, lastLoad, docRows] = await Promise.all([
    db.load.aggregate({ where: completed, _sum: { rate: true }, _count: true }),
    db.load.aggregate({ where: { ...completed, deliveredAt: { gte: daysAgo(90) } }, _sum: { rate: true } }),
    db.load.count({ where: { ...completed, deliveredAt: { lte: db.load.fields.deliveryAt } } }),
    db.load.count({ where: { ...party, status: { in: [...ACTIVE_LOAD_STATUSES] } } }),
    db.invoice.findMany({ where: { customerId: id, status: "SENT" }, select: { amount: true, taxRate: true, dueAt: true } }),
    db.load.findFirst({ where: party, orderBy: { pickupAt: "desc" }, select: { pickupAt: true } }),
    db.document.findMany({ where: { customerId: id }, distinct: ["kind"], select: { kind: true } }),
  ]);
  const now = new Date();
  const lifetimeLoads = c._count.loads + c._count.brokerLoads;
  const delivered = totals._count;
  const revenue = totals._sum.rate ?? 0;
  const revenue90 = totals90._sum.rate ?? 0;
  const onTimePct = delivered ? Math.round((onTime / delivered) * 100) : null;
  const ar = openInvoices.reduce((a, i) => a + grossInvoice(i), 0);
  const overdue = openInvoices.filter((i) => i.dueAt < now);
  const overdueAmt = overdue.reduce((a, i) => a + grossInvoice(i), 0);
  const ratio = c.creditLimit > 0 ? ar / c.creditLimit : 0;
  const tone = creditTone(ratio);
  const required = requiredCustomerDocs(c.kind);
  const have = new Set(docRows.map((d) => d.kind));
  const missingDocs = required.filter((k) => !have.has(k));
  const dormantDays = lastLoad ? Math.floor((now.getTime() - lastLoad.pickupAt.getTime()) / 86_400_000) : null;

  // A row links only where the destination can resolve it; the rest are plain text.
  const attention: { tone: Tone; text: string; href?: string }[] = [];
  if (overdue.length) {
    attention.push(finance
      ? { tone: "danger", text: `${money(overdueAmt)} overdue across ${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`, href: `/customers/${id}?tab=invoices` }
      : { tone: "danger", text: `${money(overdueAmt)} overdue across ${overdue.length} invoice${overdue.length === 1 ? "" : "s"} — check with accounting before booking new loads` });
  }
  if (ratio >= 1) attention.push({ tone: "danger", text: `Over the credit limit — ${money(ar)} open against ${money(c.creditLimit)}`, href: `/customers/${id}?tab=details` });
  else if (tone === "danger") attention.push({ tone: "warn", text: `${Math.round(ratio * 100)}% of the credit limit in use`, href: `/customers/${id}?tab=details` });
  if (missingDocs.length) attention.push({ tone: "warn", text: `${missingDocs.map((k) => DOC_KIND_LABELS[k]).join(" and ")} not on file`, href: `/customers/${id}?tab=documents` });
  if (lifetimeLoads > 0 && dormantDays != null && dormantDays >= DORMANT_DAYS && active === 0) attention.push({ tone: "info", text: `No loads for ${dormantDays} days — worth a call`, href: `/customers/${id}?tab=loads` });
  if (!c.contactName && !c.phone && !c.email) attention.push({ tone: "neutral", text: "No contact details on record", href: editable ? `/customers/${id}/edit` : `/customers/${id}?tab=details` });

  const tabs = visibleTabs.map((t) => ({
    key: t, label: TAB_LABELS[t], href: `/customers/${id}${t === "loads" ? "" : `?tab=${t}`}`,
    count: t === "loads" ? lifetimeLoads || undefined : t === "invoices" ? openInvoices.length || undefined : t === "documents" ? missingDocs.length || undefined : undefined,
  }));
  const newLoadHref = c.kind === "BROKER" ? `/loads/new?broker=${id}` : `/loads/new?customer=${id}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/customers" className="hover:text-fg">Customers & brokers</Link>}
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Chip tone={KIND_TONE[c.kind]} className="normal-case tracking-normal" title={CUSTOMER_KIND_LABELS[c.kind] ?? c.kind}>{KIND_SHORT[c.kind] ?? c.kind}</Chip>
            {c.contactName && <span className="text-fg">{c.contactName}</span>}
            {c.phone && <a href={`tel:${c.phone}`} className="num inline-flex items-center gap-1 hover:text-fg hover:underline"><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-fg hover:underline"><Mail className="h-3.5 w-3.5" />{c.email}</a>}
            {(c.city || c.country) && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[c.city, c.country].filter(Boolean).join(", ")}</span>}
            <span className="num">Net {c.paymentTerms}</span>
          </span>
        }
        actions={
          <>
            {editable && <LinkButton href={`/customers/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>}
            {can(user.role, "loads.edit") && <LinkButton href={newLoadHref}><Plus />New load</LinkButton>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Lifetime loads" value={number(lifetimeLoads)} hint={broker && c._count.brokerLoads ? `${number(c._count.brokerLoads)} as broker · ${active} active` : `${active} active right now`} />
        <Stat label="Revenue" value={money(revenue)} hint={`${money(revenue90)} in the last 90 days`} />
        <Stat label="Open A/R" value={money(ar)} tone={overdue.length ? "danger" : tone}
          hint={overdue.length ? `${money(overdueAmt)} overdue · ${overdue.length} of ${openInvoices.length} invoices` : openInvoices.length ? `${openInvoices.length} sent, none overdue` : "nothing outstanding"}
          spark={<div><Progress value={ratio} tone={tone} /><p className="num mt-1 text-[11px] text-fg-subtle">{Math.round(ratio * 100)}% of {money(c.creditLimit)} credit limit</p></div>} />
        <Stat label="On-time deliveries" value={onTimePct == null ? "—" : `${onTimePct}%`} tone={onTimeTone(onTimePct)} hint={delivered ? `${onTime} of ${delivered} delivered loads` : "no completed loads yet"} />
      </div>

      {attention.length > 0 && (
        <Card title="Needs attention" flush className="mb-4" actions={<span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{attention.length}</span>}>
          <ul className="divide-y divide-line">
            {attention.map((a, i) => (
              <li key={i}>
                {a.href ? (
                  <Link href={a.href} className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg hover:bg-raised">
                    <StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span><ChevronRight aria-hidden className="h-4 w-4 text-fg-faint" />
                  </Link>
                ) : (
                  <p className="flex items-center gap-3 px-4 py-2 text-[13px] text-fg"><StatusDot tone={a.tone} /><span className="flex-1">{a.text}</span></p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs active={tab} tabs={tabs} />

      {tab === "loads" && <LoadsTab customerId={id} broker={broker} />}
      {tab === "invoices" && finance && <InvoicesTab customerId={id} />}
      {tab === "documents" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DocumentsPanel user={user} target={{ type: "customer", id }} path={`/customers/${id}`} withExpiry required={required}
              description={broker ? "Set an expiry on insurance certificates and agreements that renew." : "Set an expiry on agreements that renew so they surface as alerts."} />
          </div>
          {/* A reference guide, closed by default. The documents panel already shows which required ones are on file. */}
          <section className={cn(cardClass, "self-start")}>
            <Disclosure title="What belongs here" icon={<ListChecks />} tone="neutral" className="[&>summary]:rounded-lg [&>summary]:py-3">
              <ul className="space-y-2 border-t border-line px-4 py-3 text-[13px] text-fg">
                <li><span className="font-medium">Contract</span><span className="block text-[12px] text-fg-muted">Master agreement or rate confirmation template, signed by both sides.</span></li>
                {broker && <li><span className="font-medium">Setup packet</span><span className="block text-[12px] text-fg-muted">Carrier packet returned to the broker: W-9 equivalent, insurance certificate, authority, bank letter.</span></li>}
                <li><span className="font-medium">Other</span><span className="block text-[12px] text-fg-muted">Credit applications, NDAs, correspondence worth keeping.</span></li>
              </ul>
            </Disclosure>
          </section>
        </div>
      )}
      {tab === "details" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Account" className="xl:col-span-2">
            <DL cols={3} items={[
              ["Company", c.name],
              ["Kind", CUSTOMER_KIND_LABELS[c.kind] ?? c.kind],
              ["Tax ID (INN)", c.taxId ? <span key="t" className="num">{c.taxId}</span> : "—"],
              ["Contact person", c.contactName ?? "—"],
              ["Phone", c.phone ? <a key="p" href={`tel:${c.phone}`} className="num hover:underline">{c.phone}</a> : "—"],
              ["Email", c.email ? <a key="e" href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> : "—"],
              ["Address", c.address ?? "—"],
              ["City", c.city ?? "—"],
              ["Country", c.country ?? "—"],
              ["Payment terms", <span key="n" className="num">Net {c.paymentTerms} days</span>],
              ["Credit limit", <span key="cl" className="num">{money(c.creditLimit)}</span>],
              ["Customer since", <span key="s" className="num" title={ago(c.createdAt).replace(" ago", "")}>{date(c.createdAt)}</span>],
            ]} />
          </Card>
          <div className="space-y-4">
            <Card title="Credit">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="eyebrow">Open against limit</p>
                  <p className={cn("num mt-1 text-[22px] font-semibold leading-none", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-fg")}>{Math.round(ratio * 100)}%</p>
                </div>
                <p className="num text-right text-[12px] text-fg-muted">{money(ar)}<span className="text-fg-subtle"> / {money(c.creditLimit)}</span></p>
              </div>
              <Progress value={ratio} tone={tone} className="mt-3" />
              <p className="mt-2 text-[11px] text-fg-subtle">{ratio >= 1 ? "Over the limit — hold new loads until payments land." : `${money(Math.max(0, c.creditLimit - ar))} of headroom before the limit.`}</p>
            </Card>
            <Card title="Notes">
              {c.notes ? <p className="whitespace-pre-wrap text-[13px] text-fg">{c.notes}</p>
                : <p className="text-[12px] text-fg-muted">No notes.{editable && <> <Link href={`/customers/${id}/edit`} title="Billing quirks, preferred lanes, contacts" className="text-fg hover:underline">Add some</Link></>}</p>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

async function LoadsTab({ customerId, broker }: { customerId: string; broker: boolean }) {
  const loads = await db.load.findMany({
    where: { OR: [{ customerId }, { brokerId: customerId }] }, orderBy: { pickupAt: "desc" }, take: 100,
    select: {
      id: true, reference: true, status: true, billingStage: true, customerId: true, brokerId: true, customerRef: true,
      originCity: true, destCity: true, pickupAt: true, deliveryAt: true, deliveredAt: true, distanceKm: true, rate: true,
      customer: { select: { id: true, name: true } }, broker: { select: { id: true, name: true } }, driver: { select: { id: true, name: true } },
    },
  });
  const asBroker = loads.filter((l) => l.brokerId === customerId).length;
  const showRole = broker && asBroker > 0 && asBroker < loads.length;
  const activeFirst = [...loads].sort((a, b) => Number((ACTIVE_LOAD_STATUSES as readonly string[]).includes(b.status)) - Number((ACTIVE_LOAD_STATUSES as readonly string[]).includes(a.status)));
  return (
    <Card title="Loads" flush actions={<span className="text-[11px] text-fg-subtle"><span className="num">{loads.length}</span> loads{broker && asBroker > 0 && <> · <span className="num">{asBroker}</span> as broker</>}{loads.length === 100 && " · showing the latest 100"}</span>}>
      <Table head={["Load", ...(showRole ? ["Role"] : []), "Status", "Route", broker ? "Shipper" : "Broker", "Pickup", "Delivered", "Driver", "Rate", "Billing"]}>
        {activeFirst.map((l) => {
          const late = l.deliveredAt && l.deliveredAt > l.deliveryAt;
          const counterpart = l.brokerId === customerId ? l.customer : l.broker;
          return (
            <tr key={l.id} className={l.status === "CANCELLED" ? "opacity-60" : undefined}>
              <td><Link href={`/loads/${l.id}`} title={l.customerRef ? `Ref ${l.customerRef}` : undefined} className="num font-medium text-fg hover:underline">{l.reference}</Link></td>
              {showRole && <td><Chip tone={l.brokerId === customerId ? "progress" : "info"} className="normal-case tracking-normal">{l.brokerId === customerId ? "Broker" : "Shipper"}</Chip></td>}
              <td><Badge value={l.status} label={LOAD_STATUS_LABELS[l.status as LoadStatus] ?? l.status} /></td>
              <td className="whitespace-nowrap text-fg" title={`${number(l.distanceKm)} km`}>{l.originCity} → {l.destCity}</td>
              <td className="max-w-44 truncate">{counterpart ? <Link href={`/customers/${counterpart.id}`} className="hover:underline">{counterpart.name}</Link> : <span className="text-fg-faint">—</span>}</td>
              <td className="num whitespace-nowrap text-fg-muted">{dateTime(l.pickupAt)}</td>
              <td className="whitespace-nowrap">
                {l.deliveredAt ? <span className={cn("num", late ? "text-danger" : "text-fg-muted")}>{dateTime(l.deliveredAt)}{late && <span className="ml-1 text-[11px]">late</span>}</span> : <span className="num text-fg-subtle">due {dateTime(l.deliveryAt)}</span>}
              </td>
              <td className="max-w-36 truncate">{l.driver ? <Link href={`/drivers/${l.driver.id}`} className="hover:underline">{l.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
              <td className="num">{money(l.rate)}</td>
              <td>{l.billingStage !== "NONE" ? <Badge value={l.billingStage} label={BILLING_STAGE_LABELS[l.billingStage as BillingStage] ?? l.billingStage} /> : <span className="text-fg-faint">—</span>}</td>
            </tr>
          );
        })}
      </Table>
      {loads.length === 0 && <EmptyState title="No loads yet" description="Loads booked for this account, or tendered through it as a broker, appear here newest first." />}
    </Card>
  );
}

async function InvoicesTab({ customerId }: { customerId: string }) {
  const invoices = await db.invoice.findMany({
    where: { customerId }, orderBy: { issuedAt: "desc" }, take: 100,
    select: { id: true, number: true, amount: true, taxRate: true, status: true, issuedAt: true, dueAt: true, paidAt: true, load: { select: { id: true, reference: true } } },
  });
  const now = new Date();
  const open = invoices.filter((i) => i.status === "SENT");
  const overdue = open.filter((i) => i.dueAt < now);
  const paid = invoices.filter((i) => i.status === "PAID" && i.paidAt);
  const avgDaysToPay = paid.length ? Math.round(paid.reduce((a, i) => a + (i.paidAt!.getTime() - i.issuedAt.getTime()) / 86_400_000, 0) / paid.length) : null;
  const order = (i: (typeof invoices)[number]) => (i.status === "SENT" ? (i.dueAt < now ? 0 : 1) : i.status === "DRAFT" ? 2 : 3);
  const sorted = [...invoices].sort((a, b) => order(a) - order(b));
  return (
    <Card title={<span className="flex items-center gap-1.5">Invoices<InfoTip>Overdue first, then open, then settled. Amounts include VAT.</InfoTip></span>} flush actions={
      <span className="text-[11px] text-fg-subtle">
        <span className="num">{open.length}</span> open · <span className={cn("num", overdue.length && "text-danger")}>{overdue.length}</span> overdue
        {avgDaysToPay != null && <> · pays in <span className="num">{avgDaysToPay}</span> days on average</>}
      </span>
    }>
      <Table head={["Invoice", "Load", "Issued", "Due", "Amount", "Status"]}>
        {sorted.map((i) => {
          const isOverdue = i.status === "SENT" && i.dueAt < now;
          const lateDays = isOverdue ? Math.floor((now.getTime() - i.dueAt.getTime()) / 86_400_000) : 0;
          return (
            <tr key={i.id} className={i.status === "VOID" ? "opacity-60" : undefined}>
              <td><Link href={`/finance/invoices/${i.id}`} className="num font-medium text-fg hover:underline">{i.number}</Link></td>
              <td>{i.load ? <Link href={`/loads/${i.load.id}`} className="num hover:underline">{i.load.reference}</Link> : <span className="text-fg-faint">—</span>}</td>
              <td className="num whitespace-nowrap text-fg-muted">{date(i.issuedAt)}</td>
              <td className="whitespace-nowrap"><span className={cn("num", isOverdue ? "text-danger" : "text-fg-muted")}>{date(i.dueAt)}</span>{isOverdue && <span className="ml-1.5 text-[11px] text-danger">{lateDays}d late</span>}</td>
              <td className="num" title={i.taxRate ? `${money(i.amount)} + ${Math.round(i.taxRate * 100)}% VAT` : undefined}>{money(grossInvoice(i))}</td>
              <td><span title={i.paidAt ? `Paid ${date(i.paidAt)}` : undefined}><Badge value={isOverdue ? "OVERDUE" : i.status} dot /></span></td>
            </tr>
          );
        })}
      </Table>
      {invoices.length === 0 && <EmptyState title="No invoices yet" description="Invoices are generated from delivered loads in the billing queue." />}
    </Card>
  );
}
