import Link from "next/link";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { CLAIM_FAULT_LABELS, CLAIM_TYPE_LABELS } from "@/lib/constants";
import { money, number } from "@/lib/format";
import { Card, InfoTip, Table } from "@/components/ui";
import { Bars, type ChartTone } from "@/components/charts-lite";
import { Donut, TrendLine } from "@/components/charts-lazy";
import { claimAnalytics } from "./query";
import { claimStatusLabel, claimsHref, type ClaimFilters } from "./shared";

const FAULT_CHART_TONE: Record<string, ChartTone> = { OURS: "danger", THIRD_PARTY: "info", SHARED: "warn", UNKNOWN: "neutral" };

/** Analytics tab: where claims come from, where they sit in the lifecycle, how the volume moves and who is involved. */
export async function ClaimAnalytics({ where, filters }: { where: Prisma.ClaimWhereInput; filters: ClaimFilters }) {
  const a = await claimAnalytics(where);
  const tableHref = (patch: Partial<Record<keyof ClaimFilters, string | undefined>>) => claimsHref(filters, { tab: undefined, ...patch });
  const ours = a.faults.find((f) => f.fault === "OURS")?.count ?? 0;
  const oursPct = a.total ? Math.round((ours / a.total) * 100) : 0;
  const opened12 = a.monthly.reduce((x, m) => x + m.opened, 0);
  const closed12 = a.monthly.reduce((x, m) => x + m.closed, 0);
  const inFlight = a.funnel.filter((f) => ["NEGOTIATION", "DISPUTED", "LITIGATION"].includes(f.status)).reduce((x, f) => x + f.count, 0);
  const topType = a.byType[0];
  const topExposure = [...a.byType].sort((x, y) => y.claimed - x.claimed)[0];
  const titled = (title: string, tip: ReactNode) => <span className="flex items-center gap-1.5">{title}<InfoTip>{tip}</InfoTip></span>;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title={topType ? titled("Claims by type", `Most frequent: ${CLAIM_TYPE_LABELS[topType.type] ?? topType.type} (${topType.count}) · largest exposure: ${CLAIM_TYPE_LABELS[topExposure.type] ?? topExposure.type} ${money(topExposure.claimed)}.`) : "Claims by type"}
        actions={<span className="num text-[11px] text-fg-subtle">{number(a.total)} claims</span>}>
        <Bars
          data={a.byType.map((t) => ({
            label: CLAIM_TYPE_LABELS[t.type] ?? t.type, value: t.count, tone: "info" as const,
            hint: `${t.count} claims · claimed ${money(t.claimed)} · settled ${money(t.settled)}`,
            href: tableHref({ type: t.type }),
          }))}
          format="number" labelWidth={140} valueWidth={40} />
      </Card>

      <Card title={titled("Fault split", a.total === 0 ? "Fault is recorded on every claim; the split appears once claims are filed."
          : `${ours} of ${a.total} claims are our fault — those are the ones training and maintenance can prevent.`)}
        actions={a.total > 0 && <span className={oursPct >= 50 ? "num text-[11px] text-warn" : "num text-[11px] text-fg-subtle"}>{oursPct}% ours</span>}>
        <Donut
          data={a.faults.map((f) => ({ name: CLAIM_FAULT_LABELS[f.fault] ?? f.fault, value: f.count }))}
          tones={a.faults.map((f) => FAULT_CHART_TONE[f.fault] ?? "neutral")}
          height={220} totalLabel="claims" />
      </Card>

      <Card title={titled("Status funnel", "Where each claim sits now, in lifecycle order.")} actions={inFlight > 0 && <span className="num text-[11px] text-fg-subtle">{inFlight} contested</span>}>
        {/* Counts are small whole numbers: Bars prints them as-is (a numeric axis would repeat ticks like 0 0 1 1). */}
        <Bars
          data={a.total === 0 ? [] : a.funnel.map((f) => ({
            label: claimStatusLabel(f.status), value: f.count,
            hint: `${f.count} ${f.count === 1 ? "claim" : "claims"} ${claimStatusLabel(f.status).toLowerCase()}`,
            href: f.count > 0 ? tableHref({ status: f.status }) : undefined,
          }))}
          tone="progress" format="number" labelWidth={104} valueWidth={40} />
      </Card>

      <Card title={titled("Claims per month", "Opened counts the month the claim was filed, closed the month it was paid, closed or denied. A gap between the lines is the backlog growing or shrinking.")} className="xl:col-span-2"
        actions={<span className="num text-[11px] text-fg-subtle">{opened12} opened · {closed12} closed · last 12 months</span>}>
        <TrendLine data={a.monthly} lines={[{ key: "opened", name: "Opened", tone: "warn" }, { key: "closed", name: "Closed", tone: "ok" }]} height={240} format="number" />
      </Card>

      <Card title="Top drivers by claims" flush>
        <Table dense head={["Driver", "Claims", "Open", "Claimed", <span key="r" className="flex items-center justify-end gap-1">Per 100 loads<InfoTip>Each driver&apos;s non-cancelled loads with a pickup in the last 12 months.</InfoTip></span>]}
          empty={a.drivers.length === 0} emptyTitle="No driver-linked claims" emptyDescription="Claims that name a driver are ranked here, with their load volume over the last 12 months for context.">
          {a.drivers.map((d) => (
            <tr key={d.id}>
              <td>
                <Link href={`/drivers/${d.id}`} className="font-medium text-fg hover:underline">{d.name}</Link>
                {d.ours > 0 && <div className="text-[11px] text-danger">{d.ours} our fault</div>}
              </td>
              <td className="num">{d.claims}</td>
              <td className={d.open ? "num text-warn" : "num text-fg-subtle"}>{d.open}</td>
              <td className="num">{money(d.claimed)}</td>
              <td className="num text-right text-fg-muted" title={`${d.loads} loads in the last 12 months`}>{d.per100 == null ? "—" : d.per100}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
