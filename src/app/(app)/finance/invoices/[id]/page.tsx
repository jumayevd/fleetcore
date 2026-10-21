import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EQUIPMENT_LABELS } from "@/lib/constants";
import { date, kg, km, money2 } from "@/lib/format";
import { Badge, LinkButton, Tip, cn } from "@/components/ui";
import { getLetterhead, invoiceDetail } from "../../data";
import { daysLate, financeHref, hasBankDetails, invoiceBadge, invoiceTotal, isOverdue, wasTonu } from "../../shared";
import { InvoiceActions } from "../../invoice-actions";

export async function generateMetadata({ params }: PageProps<"/finance/invoices/[id]">) {
  if (!(await getCurrentUser())) return {};
  const inv = await invoiceDetail((await params).id);
  return { title: inv ? `${inv.number} · ${inv.customer.name}` : "Invoice not found" };
}

/**
 * Paper is always white: when printing, the Graphite tokens are remapped to CSS system colours so a
 * Night-theme screen still prints a light sheet. No palette values are hardcoded.
 */
const PRINT_CSS = `@media print {
  :root, :root[data-theme] {
    color-scheme: light;
    --canvas: Canvas; --surface: Canvas; --raised: Canvas; --sunken: Canvas; --overlay: Canvas; --neutral-soft: Canvas;
    --fg: CanvasText; --fg-muted: CanvasText; --fg-subtle: GrayText; --fg-faint: GrayText;
    --line: GrayText; --line-strong: CanvasText;
  }
  @page { margin: 14mm; }
}`;

function Row({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-subtle">{k}</dt>
      <dd className={cn("text-fg", mono && "num")}>{v}</dd>
    </>
  );
}

export default async function InvoicePage({ params }: PageProps<"/finance/invoices/[id]">) {
  const user = await requireUser("finance.view");
  const { id } = await params;
  const [inv, co] = await Promise.all([invoiceDetail(id), getLetterhead()]);
  if (!inv) notFound();

  const now = new Date();
  const vat = inv.amount * inv.taxRate;
  const total = invoiceTotal(inv);
  const overdue = isOverdue(inv, now);
  const late = daysLate(inv.dueAt, now);
  const load = inv.load;
  // Truck ordered, not used: bill the fee, not a delivery (the load reads Invoiced by now, never stamped delivered).
  const tonu = load ? wasTonu(load) : false;
  const billTo = inv.customer;
  const viaBroker = billTo.kind === "BROKER" && load && load.customer.id !== billTo.id;
  const statusLine = inv.status === "PAID" ? `Paid ${date(inv.paidAt)}`
    : inv.status === "VOID" ? "Voided — not payable"
    : inv.status === "DRAFT" ? "Draft — mark it sent once it has gone to the customer"
    : overdue ? `${late} ${late === 1 ? "day" : "days"} overdue`
    : late === 0 ? "Due today" : `Due in ${-late} ${-late === 1 ? "day" : "days"}`;
  const companyLine = [co.taxId && `INN ${co.taxId}`, co.licenseNumber && `Licence ${co.licenseNumber}`].filter(Boolean).join(" · ");
  const contactLine = [co.phone, co.email].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <style href="invoice-print" precedence="default">{PRINT_CSS}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={financeHref({ tab: "invoices" })} variant="ghost" size="sm"><ArrowLeft />Invoices</LinkButton>
          {/* The full status line is on the sheet just below; the toolbar keeps the badge, with the line on hover. Overdue stays spelled out. */}
          <Tip content={statusLine}><Badge value={invoiceBadge(inv, now)} dot /></Tip>
          {overdue && <span className="text-[12px] text-danger">{statusLine}</span>}
        </div>
        <InvoiceActions id={inv.id} number={inv.number} status={inv.status} loadRef={load?.reference} readOnly={!can(user.role, "finance.edit")} />
      </div>

      <article className="rounded-lg border border-line bg-surface p-8 sm:p-10 print:border-0 print:p-0">
        {/* Letterhead */}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight text-fg">{co.brand}</p>
            {co.legalName !== co.brand && <p className="text-[13px] text-fg-muted">{co.legalName}</p>}
            <p className="mt-2 whitespace-pre-line text-[12px] leading-5 text-fg-muted">{co.address}</p>
            {contactLine && <p className="text-[12px] leading-5 text-fg-muted">{contactLine}</p>}
            {companyLine && <p className="num mt-1 text-[11px] text-fg-subtle">{companyLine}</p>}
          </div>
          <div className="text-right">
            <p className="eyebrow">Invoice</p>
            <p className="num mt-1 text-xl font-semibold text-fg">{inv.number}</p>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-right text-[12px]">
              <Row k="Issued" v={date(inv.issuedAt)} />
              <Row k="Due" v={<span className={cn(overdue && "font-medium text-danger")}>{date(inv.dueAt)}</span>} />
              <Row k="Terms" v={`Net ${billTo.paymentTerms}`} />
              {inv.paidAt && <Row k="Paid" v={<span className="text-ok">{date(inv.paidAt)}</span>} />}
            </dl>
            <p className={cn("mt-2 text-[12px] font-medium", inv.status === "PAID" ? "text-ok" : overdue ? "text-danger" : "text-fg-subtle")}>{statusLine}</p>
          </div>
        </header>

        {/* Parties */}
        <section className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Bill to</p>
            <p className="mt-1.5 text-[14px] font-semibold text-fg">{billTo.name}</p>
            <div className="mt-0.5 text-[12px] leading-5 text-fg-muted">
              {billTo.contactName && <p>{billTo.contactName}</p>}
              {billTo.address && <p>{billTo.address}</p>}
              {(billTo.city || billTo.country) && <p>{[billTo.city, billTo.country].filter(Boolean).join(", ")}</p>}
              {billTo.email && <p>{billTo.email}</p>}
            </div>
            {billTo.taxId && <p className="num mt-1 text-[11px] text-fg-subtle">INN {billTo.taxId}</p>}
            {viaBroker && <p className="mt-2 text-[11px] text-fg-subtle">Freight arranged for {load.customer.name}</p>}
          </div>
          <div>
            <p className="eyebrow">Shipment</p>
            {load ? (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                <Row k="Load" v={<Link href={`/loads/${load.id}`} className="hover:underline">{load.reference}</Link>} />
                {load.customerRef && <Row k="Your ref" v={load.customerRef} />}
                <Row k="Route" mono={false} v={<span className="inline-flex items-center gap-1">{load.originName}, {load.originCity}<ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />{load.destName}, {load.destCity}</span>} />
                <Row k="Equipment" mono={false} v={EQUIPMENT_LABELS[load.equipment] ?? load.equipment} />
                {(load.driver || load.truck) && <Row k="Driver · truck" mono={false} v={[load.driver?.name, load.truck?.unitNumber].filter(Boolean).join(" · ")} />}
                {tonu ? (
                  <>
                    <Row k="Ordered for" v={date(load.pickupAt)} />
                    <Row k="Outcome" mono={false} v="Truck ordered, not used" />
                  </>
                ) : (
                  <>
                    <Row k="Picked up" v={date(load.pickupAt)} />
                    <Row k="Delivered" v={date(load.deliveredAt)} />
                    <Row k="Proof of delivery" mono={false} v={load.podSignedBy ? `signed by ${load.podSignedBy}` : <span className="text-fg-subtle">on file</span>} />
                  </>
                )}
              </dl>
            ) : (
              <p className="mt-1.5 text-[12px] text-fg-muted">
                {inv.status === "VOID" ? "No load attached. A load is released when its invoice is voided, so it can be invoiced again." : "Transportation services (no load attached)."}
              </p>
            )}
          </div>
        </section>

        {/* Line items */}
        <table className="mt-6 w-full text-[13px]">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className="eyebrow pb-2 font-medium">Description</th>
              <th className="eyebrow pb-2 text-right font-medium">Qty</th>
              <th className="eyebrow pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line align-top">
              <td className="py-3 pr-4">
                {load && tonu ? (
                  <>
                    <p className="font-medium text-fg">Truck ordered, not used — TONU fee, {load.originCity} to {load.destCity}</p>
                    <p className="mt-0.5 text-[12px] leading-5 text-fg-muted">
                      <span className="num">{load.reference}</span> · {EQUIPMENT_LABELS[load.equipment] ?? load.equipment} ordered for {date(load.pickupAt)}
                    </p>
                  </>
                ) : load ? (
                  <>
                    <p className="font-medium text-fg">Freight transportation, {load.originCity} to {load.destCity}</p>
                    <p className="mt-0.5 text-[12px] leading-5 text-fg-muted">
                      <span className="num">{load.reference}</span> · {load.commodity} · {kg(load.weightKg)}{load.pallets ? ` · ${load.pallets} pallets` : ""} · {km(load.distanceKm)} loaded
                      {load.emptyKm > 0 && ` · ${km(load.emptyKm)} repositioning`} · delivered {date(load.deliveredAt)}
                      {load.podSignedBy && ` · POD ${load.podSignedBy}`}
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-fg">Transportation services</p>
                )}
              </td>
              <td className="num py-3 text-right text-fg-muted">1</td>
              <td className="num py-3 text-right text-fg">{money2(inv.amount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Totals */}
        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-fg-muted">Subtotal</span><span className="num text-fg">{money2(inv.amount)}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">VAT {Math.round(inv.taxRate * 100)}%</span><span className="num text-fg">{money2(vat)}</span></div>
          <div className="flex justify-between border-t border-line-strong pt-2 text-[15px] font-semibold text-fg">
            <span>{inv.status === "PAID" ? "Total" : "Total due"}</span><span className="num">{money2(total)}</span>
          </div>
          {inv.status === "PAID" && (
            <div className="flex justify-between text-[12px] text-ok"><span>Paid {date(inv.paidAt)}</span><span className="num">{money2(total)}</span></div>
          )}
          {inv.status === "VOID" && <p className="text-right text-[12px] text-fg-subtle">This invoice was voided and is not payable.</p>}
        </div>

        {/* Payment details and sign-off */}
        <footer className="mt-8 grid gap-6 border-t border-line pt-6 text-[12px] sm:grid-cols-2">
          <div>
            <p className="eyebrow">Pay by bank transfer</p>
            {hasBankDetails(co) ? (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {co.bank.name && <Row k="Bank" mono={false} v={co.bank.name} />}
                {co.bank.account && <Row k="Account" v={co.bank.account} />}
                {co.bank.mfo && <Row k="MFO" v={co.bank.mfo} />}
                {co.bank.swift && <Row k="SWIFT" v={co.bank.swift} />}
                <Row k="Beneficiary" mono={false} v={co.legalName} />
              </dl>
            ) : (
              <p className="mt-1.5 text-fg-subtle">Bank details are not set. Add them under Company profile and they will print here.</p>
            )}
            <p className="mt-3 leading-5 text-fg-muted">
              Please quote <span className="num text-fg">{inv.number}</span> with your payment. Payment is due within {billTo.paymentTerms} days of the invoice date.
            </p>
          </div>
          <div>
            {inv.notes && (
              <div className="mb-4">
                <p className="eyebrow">Notes</p>
                <p className="mt-1.5 whitespace-pre-line leading-5 text-fg-muted">{inv.notes}</p>
              </div>
            )}
            {co.director && (
              <div className="mt-8">
                <div className="h-px w-48 bg-line-strong" />
                <p className="mt-1.5 text-fg-muted">{co.director}, Director</p>
              </div>
            )}
            {co.insurance.carrier && (
              <p className="mt-3 text-[11px] text-fg-subtle">Cargo liability insured by {co.insurance.carrier}{co.insurance.policy && <> · policy <span className="num">{co.insurance.policy}</span></>}</p>
            )}
          </div>
        </footer>
      </article>
    </div>
  );
}
