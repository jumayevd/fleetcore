import Link from "next/link";
import { money, number } from "@/lib/format";
import { Card, Chip, InfoTip, Progress, Table, cn } from "@/components/ui";
import { SimpleBar } from "@/components/charts-lazy";
import type { CustomerAging } from "./data";
import { AGING_BUCKETS, creditTone, lateTone, type AgingKey } from "./shared";

const TONE_TEXT = { neutral: "text-fg-muted", warn: "text-warn", danger: "text-danger" } as const;

export function AgingTab({ aging, rows }: { aging: Record<AgingKey, number>; rows: CustomerAging[] }) {
  const total = Object.values(aging).reduce((a, b) => a + b, 0);
  const overdue = total - aging.current;
  const chart = AGING_BUCKETS.map((b) => ({ bucket: b.short, amount: Math.round(aging[b.key]) }));
  const overdueCustomers = rows.filter((r) => r.overdue > 0).length;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title={<span className="flex items-center gap-1.5">Receivables by age<InfoTip>Sent, unpaid invoices including VAT, by how far past their due date they are.</InfoTip></span>}
        actions={
          <span className="num text-[11px] text-fg-subtle">
            {money(total)}
            {overdue > 0 && <> · <span className="text-danger" title={`Across ${number(overdueCustomers)} ${overdueCustomers === 1 ? "customer" : "customers"}`}>{money(overdue)} past due</span></>}
          </span>
        }>
        <SimpleBar data={chart} dataKey="amount" nameKey="bucket" money tone={overdue > 0 ? "warn" : "info"} height={190} />
        <ul className="mt-3 divide-y divide-line border-t border-line text-[12px]">
          {AGING_BUCKETS.map((b, idx) => {
            const v = aging[b.key];
            const share = total ? Math.round((v / total) * 100) : 0;
            const tone = idx === 0 ? "neutral" : idx === 1 ? "warn" : "danger";
            return (
              <li key={b.key} className="flex items-center justify-between gap-3 py-1.5">
                <span className={cn("flex items-center gap-2", TONE_TEXT[tone])}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", idx === 0 ? "bg-fg-faint" : idx === 1 ? "bg-warn" : "bg-danger")} />{b.label}
                </span>
                <span className="num text-fg"><span className="text-fg-subtle">{share}% · </span>{money(v)}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card flush className="xl:col-span-2" title="Open balances by customer"
        actions={<span className="num text-[11px] text-fg-subtle">{number(rows.length)} with open invoices</span>}>
        <Table dense
          head={["Customer", "Terms", <span key="n" className="block text-right">Invoices</span>, <span key="o" className="block text-right">Open</span>, <span key="d" className="block text-right">Overdue</span>, "Oldest",
            <span key="c" className="inline-flex items-center gap-1">Credit used<InfoTip>Open balance as a share of the customer&apos;s credit limit.</InfoTip></span>]}
          empty={rows.length === 0} emptyTitle="No open receivables" emptyDescription="Sent invoices appear here grouped by the party that owes them.">
          {rows.map((r) => {
            const tone = lateTone(r.oldestDays);
            const credit = creditTone(r.creditUsed);
            return (
              <tr key={r.customer.id}>
                <td className="max-w-56">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/customers/${r.customer.id}`} className="truncate font-medium text-fg hover:underline">{r.customer.name}</Link>
                    {r.customer.kind === "BROKER" && <Chip>Broker</Chip>}
                  </div>
                </td>
                <td className="num whitespace-nowrap text-fg-muted">Net {r.customer.paymentTerms}</td>
                <td className="num text-right text-fg-muted">{r.count}{r.overdueCount > 0 && <span className="text-danger"> · {r.overdueCount} late</span>}</td>
                <td className="num text-right font-medium">{money(r.open)}</td>
                <td className={cn("num text-right", r.overdue > 0 ? "font-medium text-danger" : "text-fg-faint")}>{r.overdue > 0 ? money(r.overdue) : "—"}</td>
                <td className="whitespace-nowrap">
                  {r.oldest && (
                    <Link href={`/finance/invoices/${r.oldest.id}`} title={`Oldest open invoice: ${r.oldest.number}`} className={cn("num text-[12px] hover:underline", TONE_TEXT[tone])}>
                      {r.oldestDays > 0 ? `${r.oldestDays} d late` : r.oldestDays === 0 ? "due today" : `due in ${-r.oldestDays} d`}
                    </Link>
                  )}
                </td>
                <td className="w-40">
                  <div className="flex items-center gap-2">
                    <Progress value={r.creditUsed} tone={credit === "neutral" ? "info" : credit} className="w-20" />
                    <span className={cn("num text-[11px]", credit === "neutral" ? "text-fg-subtle" : TONE_TEXT[credit])}>{Math.round(r.creditUsed * 100)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
