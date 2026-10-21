import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { date, money, number } from "@/lib/format";
import { Badge, Card, Chip, FilterPills, LinkButton, Table, cn } from "@/components/ui";
import type { InvoiceRow } from "./data";
import {
  FILTER_LABELS, INVOICE_FILTERS, INVOICE_PAGE_SIZE, daysLate, financeHref, invoiceBadge, invoiceOrder, invoiceTotal, isOverdue, type InvoiceFilter,
} from "./shared";
import { InvoiceActions } from "./invoice-actions";

const EMPTY: Record<InvoiceFilter, [string, string]> = {
  open: ["No open invoices", "Every invoice has been paid or voided. New drafts appear here when loads are invoiced from the billing queue."],
  overdue: ["No overdue invoices", "Every sent invoice is still within its payment terms."],
  DRAFT: ["No draft invoices", "Create one from the billing queue, then mark it sent once it has gone to the customer."],
  SENT: ["No invoices awaiting payment", "Sent invoices stay here until a payment is recorded."],
  PAID: ["No paid invoices yet", "Payments recorded against sent invoices appear here."],
  VOID: ["No voided invoices", "Voided invoices are kept for the record and listed here."],
  all: ["No invoices yet", "Invoices are created from delivered loads on the billing queue."],
};

/** Due date. The second line is kept for what needs chasing (late, or due within a week); the rest is on hover. */
function Due({ i, now }: { i: InvoiceRow; now: Date }) {
  if (i.status === "PAID") {
    const early = i.paidAt ? daysLate(i.dueAt, i.paidAt) : null;
    return (
      <span className="num whitespace-nowrap text-fg-muted" title={`Paid ${date(i.paidAt)}${early != null && early > 0 ? ` · ${early} d late` : ""}`}>
        {date(i.dueAt)}
      </span>
    );
  }
  if (i.status === "VOID" || i.status === "DRAFT") return <span className="num text-fg-subtle">{date(i.dueAt)}</span>;
  const late = daysLate(i.dueAt, now);
  const overdue = late > 0;
  const soon = !overdue && late >= -7;
  const label = overdue ? `${late} d late` : late === 0 ? "due today" : `due in ${-late} d`;
  return (
    <div className="whitespace-nowrap" title={overdue || soon ? undefined : label}>
      <div className={cn("num", overdue ? "font-medium text-danger" : "text-fg-muted")}>{date(i.dueAt)}</div>
      {(overdue || soon) && <div className={cn("text-[11px]", overdue ? "text-danger" : "text-warn")}>{label}</div>}
    </div>
  );
}

/** Range shown and links to the neighbouring pages, when a filter has more invoices than one page holds. */
function Pager({ filter, page, pages, shown, count }: { filter: InvoiceFilter; page: number; pages: number; shown: number; count: number }) {
  const from = (page - 1) * INVOICE_PAGE_SIZE + 1;
  const href = (p: number) => financeHref({ tab: "invoices", status: filter, page: p });
  const [prev, next] = invoiceOrder(filter) === "due" ? ["Due sooner", "Due later"] : ["Newer", "Older"];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] text-fg-subtle">
      <span title={invoiceOrder(filter) === "due" ? "Due soonest first" : "Most recent first"}>
        <span className="num">{number(from)}–{number(from + shown - 1)}</span> of <span className="num">{number(count)}</span>
      </span>
      <div className="flex items-center gap-1">
        {page > 1 && <LinkButton href={href(page - 1)} variant="ghost" size="sm"><ArrowLeft />{prev}</LinkButton>}
        <span className="num px-1">Page {page} of {pages}</span>
        {page < pages && <LinkButton href={href(page + 1)} variant="ghost" size="sm">{next}<ArrowRight /></LinkButton>}
      </div>
    </div>
  );
}

export function InvoicesTab({ invoices, filter, counts, page, pages, editable, now }: {
  invoices: InvoiceRow[]; filter: InvoiceFilter; counts: Record<InvoiceFilter, number>; page: number; pages: number; editable: boolean; now: Date;
}) {
  const count = counts[filter];
  const total = invoices.reduce((a, i) => a + invoiceTotal(i), 0);
  const overdueTotal = invoices.filter((i) => isOverdue(i, now)).reduce((a, i) => a + invoiceTotal(i), 0);
  const [emptyTitle, emptyDescription] = EMPTY[filter];
  return (
    <div className="space-y-3">
      <FilterPills active={filter} items={INVOICE_FILTERS.map((k) => ({ key: k, label: FILTER_LABELS[k], href: financeHref({ tab: "invoices", status: k }), count: counts[k] }))} />
      <Card flush
        actions={
          <span className="num text-[11px] text-fg-subtle">
            {number(count)} {count === 1 ? "invoice" : "invoices"} · {money(total)} incl. VAT{pages > 1 && " on this page"}
            {overdueTotal > 0 && filter !== "overdue" && <> · <span className="text-danger">{money(overdueTotal)} overdue</span></>}
          </span>
        }
        title={`${FILTER_LABELS[filter]} invoices`}>
        <Table dense
          head={["Invoice", "Bill to", "Issued", "Due", <span key="t" className="block text-right">Total incl. VAT</span>, "Status", ""]}
          empty={invoices.length === 0} emptyTitle={emptyTitle} emptyDescription={emptyDescription}>
          {invoices.map((i) => (
            <tr key={i.id} className="group">
              <td>
                <Link href={`/finance/invoices/${i.id}`} className="num font-medium text-fg hover:underline">{i.number}</Link>
                {/* The load stays visible: it is a link people follow. Its route waits on hover. */}
                {i.load && (
                  <div className="num text-[11px] text-fg-subtle">
                    <Link href={`/loads/${i.load.id}`} title={`${i.load.originCity} → ${i.load.destCity}`} className="hover:underline">{i.load.reference}</Link>
                  </div>
                )}
              </td>
              <td className="max-w-60">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Link href={`/customers/${i.customer.id}`} title={i.load ? undefined : "Transportation services (no load attached)"} className="truncate text-fg hover:underline">{i.customer.name}</Link>
                  {i.customer.kind === "BROKER" && <Chip>Broker</Chip>}
                </span>
              </td>
              <td className="num whitespace-nowrap text-fg-muted">{date(i.issuedAt)}</td>
              <td><Due i={i} now={now} /></td>
              <td className="num text-right font-medium">{money(invoiceTotal(i))}</td>
              <td><Badge value={invoiceBadge(i, now)} dot /></td>
              <td className="w-px whitespace-nowrap">{editable && <InvoiceActions id={i.id} number={i.number} status={i.status} loadRef={i.load?.reference} compact />}</td>
            </tr>
          ))}
        </Table>
        {pages > 1 && <Pager filter={filter} page={page} pages={pages} shown={invoices.length} count={count} />}
      </Card>
    </div>
  );
}
