import Link from "next/link";
import type { Trailer, Truck } from "@prisma/client";
import { maintenanceSummary } from "@/lib/stats";
import { WORK_ORDER_CATEGORY_LABELS, humanize } from "@/lib/constants";
import { fmtMoneyCompact, km, money, money2, number } from "@/lib/format";
import { Card, Chip, InfoTip, Stat, Table, type Tone } from "@/components/ui";
import { Bars } from "@/components/charts-lite";
import { Donut } from "@/components/charts-lazy";
import { countUnits, daysBetween, leaseRows, periodRange, PERIODS, type PeriodKey } from "../_lib/data";
import { maintenanceHref, trailerHref, truckHref } from "../_lib/links";
import { NO_VENDOR, plural } from "../_lib/shared";

/** "+12%" / "-8%" against the previous window; undefined when there is nothing to compare with. */
const delta = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? "+" : "-"}${Math.round((Math.abs(cur - prev) / prev) * 100)}%` : undefined);
/** Spending more is a caution, not a win. */
const costTone = (cur: number, prev: number): Tone => (cur > prev ? "warn" : "ok");
/** `maintenanceSummary` groups work orders without a vendor under the same wording as the repair log filter. */
const isNoVendor = (name: string) => name === NO_VENDOR;
/** Work orders without a unit are grouped under this name by `maintenanceSummary`. */
const NO_UNIT = "—";

export async function SummaryTab({ period, trucks, trailers }: { period: PeriodKey; trucks: Truck[]; trailers: Trailer[] }) {
  const r = periodRange(period);
  const [cur, prev] = await Promise.all([maintenanceSummary(r.from, r.to), maintenanceSummary(r.prevFrom, r.prevTo)]);
  const lease = leaseRows(trucks);
  const unitsServiced = cur.perUnit.filter((u) => u.name !== NO_UNIT).length;
  const prevUnitsServiced = prev.perUnit.filter((u) => u.name !== NO_UNIT).length;
  const avgPerUnit = unitsServiced ? cur.spend / unitsServiced : 0;
  const prevAvg = prevUnitsServiced ? prev.spend / prevUnitsServiced : 0;
  // Units, not jobs: two jobs on one truck are one unit off the road.
  const unitsInShop = countUnits(cur.open);
  const oldestInShop = cur.open.reduce((a, w) => Math.max(a, daysBetween(w.inAt ?? w.scheduledAt)), 0);
  // Which kinds of work keep coming back: most jobs first, the bigger spend breaking ties.
  const byFrequency = [...cur.byCategory].sort((a, b) => b.count - a.count || b.cost - a.cost);
  const categoryLabel = (c: string) => WORK_ORDER_CATEGORY_LABELS[c] ?? humanize(c);
  const unitHref = (unitNumber: string) => {
    const t = trucks.find((x) => x.unitNumber === unitNumber);
    if (t) return truckHref(t.id);
    const tr = trailers.find((x) => x.unitNumber === unitNumber);
    return tr ? trailerHref(tr.id) : undefined;
  };
  const logHref = (patch: Record<string, string | undefined>) => maintenanceHref({ tab: "log", period, ...patch });
  const compare = `vs previous ${r.days} days`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Spend" value={money(cur.spend)} delta={delta(cur.spend, prev.spend)} deltaTone={costTone(cur.spend, prev.spend)} hint={prev.spend ? compare : `${PERIODS[period].hint.toLowerCase()}, nothing before that`} />
        <Stat label="Records" value={cur.records} delta={delta(cur.records, prev.records)} deltaTone="neutral" hint={`${cur.byVendor.length} vendors · ${cur.byCategory.length} categories`} />
        <Stat label="Cost per km" value={cur.km ? `${money2(cur.costPerKm)}` : "—"} delta={cur.km && prev.km ? delta(cur.costPerKm, prev.costPerKm) : undefined} deltaTone={costTone(cur.costPerKm, prev.costPerKm)}
          hint={cur.km ? `spend over ${km(cur.km)} driven, from odometer readings` : "no odometer readings in this window"} />
        <Stat label="Units in shop" value={unitsInShop} tone={unitsInShop ? (oldestInShop > 21 ? "danger" : "warn") : "ok"}
          hint={!unitsInShop ? "every unit available" : cur.openCount > unitsInShop ? `${plural(cur.openCount, "job")} · oldest ${oldestInShop}d in` : `oldest ${oldestInShop}d in`} />
        <Stat label="Avg per unit" value={money(avgPerUnit)} delta={delta(avgPerUnit, prevAvg)} deltaTone={costTone(avgPerUnit, prevAvg)} hint={`${plural(unitsServiced, "unit")} serviced`} />
        <Stat label="Lease exposure" value={money(lease.totals.exposure)} tone={lease.totals.exposure > 0 ? "danger" : lease.rows.length ? "ok" : "neutral"}
          hint={lease.rows.length ? (lease.totals.overCount ? `${lease.totals.overCount} of ${lease.rows.length} leased over cap` : `${lease.rows.length} leased, all under cap`) : "no leased trucks"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Spend by vendor" actions={<Link href={logHref({})} className="text-[12px] font-medium text-fg-muted hover:text-fg">Repair log</Link>}>
          <Bars
            data={cur.byVendor.map((v) => ({
              label: isNoVendor(v.name) ? NO_VENDOR : v.name, value: v.cost, hint: `${plural(v.count, "job")} · avg ${money(v.cost / v.count)}`, tone: "info" as const,
              href: logHref({ vendor: isNoVendor(v.name) ? "__none" : v.name }),
            }))}
            format="money" labelWidth={150} valueWidth={72} />
        </Card>

        <Card title="Spend by category">
          <Donut data={cur.byCategory.map((c) => ({ name: categoryLabel(c.name), value: Math.round(c.cost) }))}
            height={236} total={fmtMoneyCompact(cur.spend)} totalLabel="spend" />
        </Card>

        <Card title={<span className="flex items-center gap-1.5">Jobs by category<InfoTip>The kinds of work that keep coming back, most frequent first.</InfoTip></span>}>
          <Bars
            data={byFrequency.map((c) => ({
              label: categoryLabel(c.name), value: c.count, hint: `${plural(c.count, "job")} · ${money(c.cost)} · avg ${money(c.cost / c.count)}`,
              href: logHref({ category: c.name }),
            }))}
            format="number" labelWidth={150} valueWidth={40} />
        </Card>

        <Card title={<span className="flex items-center gap-1.5">Units above median spend<InfoTip>Units that spent more than 1.8× the median per serviced unit (and over $500) in this window.</InfoTip></span>} flush
          actions={cur.perUnit.length > 0 && <span className="num text-[11px] text-fg-subtle">median {money(cur.median)}</span>}>
          <Table dense head={["Unit", "Jobs", "Spend", "vs median", ""]} empty={cur.flagged.length === 0}
            emptyTitle="No outliers" emptyDescription={cur.records ? `Every unit is within 1.8× the median spend of ${money(cur.median)} for this window.` : "Completed work orders in this window will be compared here."}>
            {cur.flagged.map((u) => {
              const href = unitHref(u.name);
              const ratio = cur.median ? u.cost / cur.median : 0;
              return (
                <tr key={u.name}>
                  <td>{href ? <Link href={href} className="num font-medium text-fg hover:underline">{u.name}</Link> : <span className="num">{u.name}</span>}</td>
                  <td className="num text-fg-muted">{number(u.count)}</td>
                  <td className="num font-medium">{money(u.cost)}</td>
                  <td><Chip tone={ratio >= 3 ? "danger" : "warn"} className="normal-case tracking-normal">{ratio ? `${ratio.toFixed(1)}×` : "—"}</Chip></td>
                  <td className="text-right">
                    {(() => {
                      const t = trucks.find((x) => x.unitNumber === u.name);
                      const tr = trailers.find((x) => x.unitNumber === u.name);
                      const id = t?.id ?? tr?.id;
                      return id ? <Link href={logHref({ unit: id })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Jobs</Link> : null;
                    })()}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </>
  );
}
