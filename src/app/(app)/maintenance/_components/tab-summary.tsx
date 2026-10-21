import Link from "next/link";
import type { Trailer, Truck } from "@prisma/client";
import { maintenanceSummary } from "@/lib/stats";
import { getFormat } from "@/lib/format-server";
import { Card, Chip, InfoTip, Stat, Table, type Tone } from "@/components/ui";
import { Bars } from "@/components/charts-lite";
import { Donut } from "@/components/charts-lazy";
import { durationText, repairTypeLabel } from "@/components/shop/shared";
import { countUnits, daysBetween, leaseRows, periodRange, PERIODS, type PeriodKey } from "../_lib/data";
import { maintenanceHref, trailerHref, truckHref, vendorHref } from "../_lib/links";
import { NO_VENDOR, plural } from "../_lib/shared";

/** "+12%" / "-8%" against the previous window; undefined when there is nothing to compare with. */
const delta = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? "+" : "-"}${Math.round((Math.abs(cur - prev) / prev) * 100)}%` : undefined);
/** Spending more is a caution, not a win. */
const costTone = (cur: number, prev: number): Tone => (cur > prev ? "warn" : "ok");
/** Work orders without a unit are grouped under this name by `maintenanceSummary`. */
const NO_UNIT = "—";

export async function SummaryTab({ period, trucks, trailers, money }: { period: PeriodKey; trucks: Truck[]; trailers: Trailer[]; money: boolean }) {
  const f = await getFormat();
  const r = periodRange(period);
  const [cur, prev] = await Promise.all([maintenanceSummary(r.from, r.to), maintenanceSummary(r.prevFrom, r.prevTo)]);
  const lease = leaseRows(trucks);
  const unitsServiced = cur.perUnit.filter((u) => u.name !== NO_UNIT).length;
  const unitsInShop = countUnits(cur.open);
  const oldestInShop = cur.open.reduce((a, w) => Math.max(a, daysBetween(w.inAt ?? w.scheduledAt)), 0);
  const byFrequency = [...cur.byRepairType].sort((a, b) => b.count - a.count || b.cost - a.cost);
  const unitId = (unitNumber: string) => trucks.find((x) => x.unitNumber === unitNumber)?.id ?? trailers.find((x) => x.unitNumber === unitNumber)?.id;
  const unitHref = (unitNumber: string) => {
    const t = trucks.find((x) => x.unitNumber === unitNumber);
    if (t) return truckHref(t.id);
    const tr = trailers.find((x) => x.unitNumber === unitNumber);
    return tr ? trailerHref(tr.id) : undefined;
  };
  const logHref = (patch: Record<string, string | undefined>) => maintenanceHref({ tab: "log", period, ...patch });
  const compare = `vs the ${r.days} days before`;
  const per = f.labels.distance;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {money && <Stat label="Spend" value={f.money(cur.spend)} delta={delta(cur.spend, prev.spend)} deltaTone={costTone(cur.spend, prev.spend)} hint={prev.spend ? compare : `${PERIODS[period].hint.toLowerCase()}, nothing before that`} />}
        <Stat label="Repairs completed" value={cur.records} delta={delta(cur.records, prev.records)} deltaTone="neutral" hint={`${plural(unitsServiced, "unit")} serviced`} />
        {money && (
          <Stat label={`Cost per ${per}`} value={cur.km ? f.money2(cur.costPerKm) : "—"} delta={cur.km && prev.km ? delta(cur.costPerKm, prev.costPerKm) : undefined} deltaTone={costTone(cur.costPerKm, prev.costPerKm)}
            hint={cur.km ? `spend over ${f.dist(cur.km)} driven, from odometer readings` : "no odometer readings in this window"} />
        )}
        {!money && <Stat label="Distance driven" value={cur.km ? f.dist(cur.km) : "—"} hint="from odometer readings" />}
        <Stat label="In the shop now" value={unitsInShop} tone={unitsInShop ? (oldestInShop > 21 ? "danger" : "warn") : "ok"}
          hint={!unitsInShop ? "every unit available" : cur.openCount > unitsInShop ? `${plural(cur.openCount, "job")} · oldest ${oldestInShop}d in` : `oldest ${oldestInShop}d in`} />
        <Stat label="Average time in the shop" value={cur.avgShopMs != null ? durationText(cur.avgShopMs) : "—"}
          delta={cur.avgShopMs != null && prev.avgShopMs ? delta(cur.avgShopMs, prev.avgShopMs) : undefined} deltaTone={cur.avgShopMs != null && prev.avgShopMs != null ? costTone(cur.avgShopMs, prev.avgShopMs) : "neutral"}
          hint="from going in to back in service, completed repairs" />
        {money && (
          <Stat label="Lease exposure" value={f.money(lease.totals.exposure)} tone={lease.totals.exposure > 0 ? "danger" : lease.rows.length ? "ok" : "neutral"}
            hint={lease.rows.length ? (lease.totals.overCount ? `${lease.totals.overCount} of ${lease.rows.length} leased over cap` : `${lease.rows.length} leased, all under cap`) : "no leased trucks"} />
        )}
      </div>
      {!money && <p className="mt-2 text-[12px] text-fg-subtle">Spend and costs are shown to owners, admins and fleet specialists.</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={money ? "Spend by shop" : "Repairs by shop"} actions={<Link href="/vendors" className="text-[12px] font-medium text-fg-muted hover:text-fg">Vendors</Link>}>
          <Bars
            data={cur.byVendor.map((v) => ({
              label: v.name, value: money ? v.cost : v.count, tone: "info" as const,
              hint: money ? `${plural(v.count, "repair")} · avg ${f.money(v.cost / v.count)}` : plural(v.count, "repair"),
              href: v.vendorId ? vendorHref(v.vendorId) : logHref({ vendor: v.name === NO_VENDOR ? "__none" : v.name }),
            }))}
            format={money ? f.money : "number"} labelWidth={150} valueWidth={money ? 72 : 40} />
        </Card>

        {money ? (
          <Card title="Spend by repair type">
            <Donut data={cur.byRepairType.map((c) => ({ name: repairTypeLabel(c.name), value: Math.round(c.cost) }))} height={236} total={f.money(cur.spend)} totalLabel="spend" />
          </Card>
        ) : null}

        <Card title={<span className="flex items-center gap-1.5">Repairs by type<InfoTip>The kinds of work that keep coming back, most frequent first.</InfoTip></span>}>
          <Bars
            data={byFrequency.map((c) => ({
              label: repairTypeLabel(c.name), value: c.count, href: logHref({ type: c.name }),
              hint: money ? `${plural(c.count, "repair")} · ${f.money(c.cost)} · avg ${f.money(c.cost / c.count)}` : plural(c.count, "repair"),
            }))}
            format="number" labelWidth={150} valueWidth={40} />
        </Card>

        {money && (
          <Card title={<span className="flex items-center gap-1.5">Units above median spend<InfoTip>Units that cost more than 1.8 times the median per serviced unit in this window.</InfoTip></span>} flush
            actions={cur.perUnit.length > 0 && <span className="num text-[11px] text-fg-subtle">median {f.money(cur.median)}</span>}>
            <Table dense head={["Unit", "Repairs", "Spend", "vs median", ""]} empty={cur.flagged.length === 0}
              emptyTitle="No outliers" emptyDescription={cur.records ? `Every unit is within 1.8 times the median spend of ${f.money(cur.median)} for this window.` : "Completed repairs in this window will be compared here."}>
              {cur.flagged.map((u) => {
                const href = unitHref(u.name);
                const ratio = cur.median ? u.cost / cur.median : 0;
                const id = unitId(u.name);
                return (
                  <tr key={u.name}>
                    <td>{href ? <Link href={href} className="num font-medium text-fg hover:underline">{u.name}</Link> : <span className="num">{u.name}</span>}</td>
                    <td className="num text-fg-muted">{f.number(u.count)}</td>
                    <td className="num font-medium">{f.money(u.cost)}</td>
                    <td><Chip tone={ratio >= 3 ? "danger" : "warn"}>{ratio ? `${ratio.toFixed(1)}×` : "—"}</Chip></td>
                    <td className="text-right">{id && <Link href={logHref({ unit: id })} className="text-[12px] font-medium text-fg-muted hover:text-fg">Repairs</Link>}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
