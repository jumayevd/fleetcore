import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { date, money, number } from "@/lib/format";
import { invoiceLoad } from "@/app/actions/finance";
import { Card, Cell, Chip, InfoTip, LinkButton, Table, cn } from "@/components/ui";
import type { QueueLoad } from "./data";
import { billableSince } from "./shared";
import { CreateInvoiceButton } from "./create-invoice-button";

const DAY = 86_400_000;

/** Days since the load became billable: delivery, or the day the truck was ordered for on a TONU. */
function waitingDays(l: QueueLoad, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - billableSince(l).getTime()) / DAY));
}
const waitTone = (days: number) => (days > 14 ? "text-danger" : days > 7 ? "text-warn" : "text-fg-subtle");

/** Who gets the invoice. "Broker for …" stays visible (it changes who pays); the customer ref waits on hover. */
function BillTo({ l }: { l: QueueLoad }) {
  const party = l.broker ?? l.customer;
  return (
    <Cell primary={<Link href={`/customers/${party.id}`} title={l.broker ? undefined : l.customerRef ? `Ref ${l.customerRef}` : "Direct shipper"} className="hover:underline">{party.name}</Link>}
      secondary={l.broker ? `broker for ${l.customer.name}` : undefined} />
  );
}

function LoadRef({ l }: { l: QueueLoad }) {
  return (
    <div className="flex items-center gap-1.5">
      <Link href={`/loads/${l.id}`} className="num font-medium text-fg hover:underline">{l.reference}</Link>
      {l.status === "TONU" && <Chip tone="warn" title="Truck ordered, not used — bill the TONU fee">TONU</Chip>}
    </div>
  );
}

function Route({ l }: { l: QueueLoad }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-fg-muted">
      {l.originCity}<ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />{l.destCity}
    </span>
  );
}

/** The wait shows under the date only once it is long enough to chase (over a week); otherwise on hover. */
function Delivered({ l, now }: { l: QueueLoad; now: Date }) {
  const days = waitingDays(l, now);
  const wait = days === 0 ? "today" : `${days} d waiting`;
  return (
    <div className="whitespace-nowrap" title={days > 7 ? undefined : wait}>
      <div className="text-fg-muted">
        {!l.deliveredAt && l.status === "TONU" && <span className="text-fg-subtle">ordered for </span>}
        <span className="num">{date(billableSince(l))}</span>
      </div>
      {days > 7 && <div className={cn("text-[11px]", waitTone(days))}>{wait}</div>}
    </div>
  );
}

export function QueueTab({ missing, ready, editable, now }: { missing: QueueLoad[]; ready: QueueLoad[]; editable: boolean; now: Date }) {
  const sum = (xs: QueueLoad[]) => xs.reduce((a, l) => a + l.rate, 0);
  const right = (k: string, label: string) => <span key={k} className="block text-right">{label}</span>;
  return (
    <div className="space-y-4">
      <Card flush
        title={<span className="flex items-center gap-1.5">Ready to invoice<InfoTip>Delivered loads move here once the rate confirmation and proof of delivery are on file; TONU loads need only the rate confirmation.</InfoTip></span>}
        actions={<span className="num text-[11px] text-fg-subtle">{number(ready.length)} {ready.length === 1 ? "load" : "loads"} · {money(sum(ready))}</span>}>
        <Table dense head={["Load", "Bill to", "Route", "Delivered", "Proof of delivery", right("rate", "Rate"), ""]}
          empty={ready.length === 0} emptyTitle="Nothing is ready to invoice">
          {ready.map((l) => (
            <tr key={l.id}>
              <td><LoadRef l={l} /></td>
              <td className="max-w-56"><BillTo l={l} /></td>
              <td><Route l={l} /></td>
              <td><Delivered l={l} now={now} /></td>
              <td className="text-fg-muted">
                {l.podSignedBy ? <>signed by <span className="text-fg">{l.podSignedBy}</span></>
                  : l.status === "TONU" ? <span className="text-fg-subtle" title="Nothing was delivered on a TONU load">not needed</span>
                  : <span className="text-fg-subtle">on file</span>}
              </td>
              <td className="num text-right font-medium">{money(l.rate)}</td>
              <td className="w-px whitespace-nowrap text-right">
                {editable ? (
                  <form action={invoiceLoad.bind(null, l.id)}>
                    <CreateInvoiceButton label={l.status === "TONU" ? "Invoice TONU fee" : "Create invoice"} />
                  </form>
                ) : (
                  <LinkButton href={`/loads/${l.id}`} variant="ghost" size="sm">Open load</LinkButton>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card flush
        title={<span className="flex items-center gap-1.5">Missing documents<InfoTip>Delivered loads without a rate confirmation or proof of delivery, and TONU loads without a rate confirmation, wait here until the documents are uploaded.</InfoTip></span>}
        actions={<span className="num text-[11px] text-fg-subtle">{number(missing.length)} {missing.length === 1 ? "load" : "loads"} · {money(sum(missing))} on hold</span>}>
        <Table dense head={["Load", "Bill to", "Route", "Delivered", "Missing", "Driver", right("rate", "Rate"), ""]}
          empty={missing.length === 0} emptyTitle="No loads are waiting on paperwork">
          {missing.map((l) => (
            <tr key={l.id}>
              <td><LoadRef l={l} /></td>
              <td className="max-w-56"><BillTo l={l} /></td>
              <td><Route l={l} /></td>
              <td><Delivered l={l} now={now} /></td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {l.missingDocs.map((k) => <Chip key={k} tone="warn" title={`${DOC_KIND_LABELS[k] ?? k} not uploaded`}>{k}</Chip>)}
                </div>
              </td>
              <td className="whitespace-nowrap text-fg-muted">{l.driver?.name ?? <span className="text-fg-faint">—</span>}</td>
              <td className="num text-right font-medium text-fg-muted">{money(l.rate)}</td>
              <td className="w-px whitespace-nowrap text-right">
                <LinkButton href={`/loads/${l.id}`} variant="ghost" size="sm">Open load<ArrowRight /></LinkButton>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
