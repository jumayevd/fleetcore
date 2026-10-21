import Link from "next/link";
import { EyeOff, Fuel, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { PAYER_LABELS } from "@/lib/constants";
import { getFormat } from "@/lib/format-server";
import { dayKey, fromZoned, zonedParts } from "@/lib/locale";
import { kmDriven } from "@/lib/mileage";
import { addFuelLog } from "@/app/actions/fleet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, DL, EmptyState, Field, InfoTip, Input, Progress, Stat, Table, cn } from "@/components/ui";
import { leaseStatus, type LeaseInput } from "../lib";

const DAY = 86_400_000;
const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);

export type ExpensesTruck = LeaseInput & { id: string; unitNumber: string };

/**
 * Expenses tab of the truck page: fuel over the last 30 days (spend, volume, average price, economy, fuel cost per
 * distance, measured distance, fills), repairs by who pays, six months by month, the fuel log and the lease cap.
 * Months run in company time. Without `showMoney` (view-only members) every amount is left out.
 */
export async function ExpensesTab({ truck, editable, showMoney }: { truck: ExpensesTruck; editable: boolean; showMoney: boolean }) {
  const f = await getFormat();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since365 = new Date(now.getTime() - 365 * DAY);
  const p = zonedParts(now, f.tz);
  const monthStarts = Array.from({ length: 6 }, (_, i) => fromZoned(p.y, p.m - (5 - i), 1, 0, 0, f.tz));
  const from = monthStarts[0] < since30 ? monthStarts[0] : since30;
  const monthLabel = new Intl.DateTimeFormat(f.imperial ? "en-US" : "en-GB", { month: "short", year: "2-digit", timeZone: f.tz });

  const [fuel, repairs, recentFills, monthKm] = await Promise.all([
    db.fuelLog.findMany({ where: { truckId: truck.id, date: { gte: from } }, orderBy: { date: "asc" }, select: { cost: true, liters: true, date: true, odometerKm: true } }),
    db.workOrder.findMany({
      where: { truckId: truck.id, status: "DONE", voidedAt: null, completedAt: { gte: since365 } },
      select: { cost: true, payer: true, completedAt: true, driverInformedAt: true },
    }),
    db.fuelLog.findMany({ where: { truckId: truck.id }, orderBy: { date: "desc" }, take: 12, include: { driver: { select: { name: true } } } }),
    Promise.all(monthStarts.map((m, i) => kmDriven(m, i === monthStarts.length - 1 ? now : monthStarts[i + 1], [truck.id]))),
  ]);

  // Last 30 days of fuel. Economy and cost per distance are measured fill to fill: the distance between the first and the
  // last fill with an odometer, against the fuel bought after the first one (it refilled what was burnt before it).
  const f30 = fuel.filter((x) => x.date >= since30);
  const spend = sum(f30, (x) => x.cost);
  const volume = sum(f30, (x) => x.liters);
  const withOdo = f30.filter((x) => x.odometerKm != null);
  let measured: number | null = null;
  let economy: number | null = null;
  let costPerDistance: number | null = null;
  if (withOdo.length >= 2) {
    const first = withOdo[0];
    const last = withOdo[withOdo.length - 1];
    const span = (last.odometerKm ?? 0) - (first.odometerKm ?? 0);
    if (span > 0) {
      measured = span;
      const between = f30.filter((x) => x.date > first.date && x.date <= last.date);
      economy = f.economy(span, sum(between, (x) => x.liters));
      costPerDistance = sum(between, (x) => x.cost) / span;
    }
  }

  // Repairs over the last 12 months by who pays.
  const r12 = repairs.filter((w) => w.completedAt && w.completedAt >= since365);
  const byPayer = (payer: string) => r12.filter((w) => w.payer === payer);
  const driverCharges = byPayer("DRIVER");
  const notTold = driverCharges.filter((w) => !w.driverInformedAt).length;
  const companyCost = sum(byPayer("COMPANY"), (w) => w.cost);
  const driverCost = sum(driverCharges, (w) => w.cost);
  const otherPayers = (["WARRANTY", "INVESTIGATION"] as const).map((k) => ({ k, rows: byPayer(k) })).filter((x) => x.rows.length);
  const repairTotal = companyCost + driverCost + sum(otherPayers.flatMap((x) => x.rows), (w) => w.cost);

  // Six months, by company month.
  const monthKey = (d: Date) => dayKey(d, f.tz).slice(0, 7);
  const rows = monthStarts.map((m, i) => ({ key: monthKey(m), month: monthLabel.format(m), km: monthKm[i].byTruck.get(truck.id) ?? 0, volume: 0, fuel: 0, repairs: 0 }));
  const at = (d: Date | null) => (d ? rows.find((r) => r.key === monthKey(d)) : undefined);
  for (const x of fuel) { const r = at(x.date); if (r) { r.fuel += x.cost; r.volume += x.liters; } }
  for (const w of repairs) { const r = at(w.completedAt); if (r) r.repairs += w.cost; }
  const totals = rows.reduce((a, r) => ({ km: a.km + r.km, volume: a.volume + r.volume, fuel: a.fuel + r.fuel, repairs: a.repairs + r.repairs }), { km: 0, volume: 0, fuel: 0, repairs: 0 });
  const perDistance = (cost: number, distance: number) => (distance ? f.money2(cost / distance) : "—");
  const lease = leaseStatus(truck);
  const tile = (href: string, node: React.ReactNode) => <Link href={href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{node}</Link>;
  const tileClass = "h-full transition-colors group-hover:border-line-strong";
  const vol = f.labels.volume;
  const volumeTitle = f.labels.volumeLong[0].toUpperCase() + f.labels.volumeLong.slice(1); // "Gallons"

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-fg">Fuel · last 30 days
            <InfoTip>From the fuel log. Economy, cost per {f.labels.distance} and measured {f.labels.distanceLong} run from the first to the last fill that recorded the odometer.</InfoTip>
          </h2>
          {!showMoney && <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle"><EyeOff className="h-3.5 w-3.5" />Costs are hidden for your role</span>}
        </div>
        <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", showMoney ? "xl:grid-cols-7" : "xl:grid-cols-4")}>
          {showMoney && tile("#fuel-log", <Stat className={tileClass} label="Fuel spend" value={f.money(spend)} />)}
          <Stat label={`Fuel bought (${vol})`} value={f.decimal(volume)} />
          {showMoney && <Stat label={`Average price per ${vol}`} value={volume ? f.money3(spend / volume) : "—"} />}
          <Stat label="Fuel economy" value={economy == null ? "—" : f.economyText(economy)} hint={economy == null ? "needs two fills with an odometer reading" : undefined} tone={economy == null && f30.length ? "warn" : "neutral"} />
          {showMoney && <Stat label={`Fuel cost per ${f.labels.distance}`} value={costPerDistance == null ? "—" : f.money3(costPerDistance)} />}
          <Stat label={`Measured ${f.labels.distanceLong}`} value={measured == null ? "—" : f.dist(measured)} />
          {tile("#fuel-log", <Stat className={tileClass} label="Fills" value={f30.length} hint={`${withOdo.length} with an odometer reading`} />)}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {showMoney && (
            <Card title={<span className="flex items-center gap-1.5">Repairs by who pays · last 12 months<InfoTip>Completed repair orders. A driver charge comes off what the driver earns, and only once they have been told.</InfoTip></span>}
              actions={<Link href={`/maintenance/work-orders?unit=${truck.id}&status=all`} className="text-[11px] font-medium text-fg-muted hover:text-fg">All repairs →</Link>}>
              {r12.length === 0 ? (
                <p className="text-[13px] text-fg-muted">No completed repairs in the last 12 months.</p>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="eyebrow">Company cost</p>
                      <p className="num mt-1 text-[20px] font-semibold leading-none text-fg">{f.money(companyCost)}</p>
                      <p className="mt-1 text-[11px] text-fg-subtle">{byPayer("COMPANY").length} repair{byPayer("COMPANY").length === 1 ? "" : "s"}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Charged to drivers</p>
                      <p className="num mt-1 text-[20px] font-semibold leading-none text-fg">{f.money(driverCost)}</p>
                      <p className={cn("mt-1 text-[11px]", notTold ? "text-warn" : "text-fg-subtle")}>
                        {driverCharges.length} charge{driverCharges.length === 1 ? "" : "s"}{notTold ? ` · ${notTold} driver${notTold === 1 ? "" : "s"} not told yet` : ""}
                      </p>
                    </div>
                  </div>
                  {repairTotal > 0 && (
                    <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <div className="bg-info" style={{ width: `${(companyCost / repairTotal) * 100}%` }} />
                      <div className="bg-warn" style={{ width: `${(driverCost / repairTotal) * 100}%` }} />
                    </div>
                  )}
                  {otherPayers.length > 0 && (
                    <p className="mt-2 text-[12px] text-fg-muted">
                      {otherPayers.map((x) => `${PAYER_LABELS[x.k]}: ${f.money(sum(x.rows, (w) => w.cost))} (${x.rows.length})`).join(" · ")}
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          <Card title={<span className="flex items-center gap-1.5">Last 6 months<InfoTip>Distance comes from odometer readings: fuel fills, repair orders, saved readings and the dated odometer. Fuel by fill date, repairs by completion date, months in company time.</InfoTip></span>} flush>
            <Table dense stickyHead={false} head={["Month", "Distance", `Fuel (${vol})`, ...(showMoney ? ["Fuel cost", "Repairs", "Total", `Per ${f.labels.distance}`] : []), f.labels.economy]}>
              {rows.map((r) => (
                <tr key={r.key} className={!r.km && !r.fuel && !r.repairs ? "text-fg-subtle" : undefined}>
                  <td className="font-medium text-fg">{r.month}</td>
                  <td className="num">{f.dist(Math.round(r.km))}</td>
                  <td className="num text-fg-muted">{f.decimal(r.volume)}</td>
                  {showMoney && <>
                    <td className="num text-fg-muted">{f.money(r.fuel)}</td>
                    <td className="num text-fg-muted">{f.money(r.repairs)}</td>
                    <td className="num">{f.money(r.fuel + r.repairs)}</td>
                    <td className="num">{perDistance(r.fuel + r.repairs, r.km)}</td>
                  </>}
                  <td className="num text-fg-muted">{f.economyText(f.economy(r.km, r.volume))}</td>
                </tr>
              ))}
              <tr className="bg-sunken/60 font-medium">
                <td>Total</td>
                <td className="num">{f.dist(Math.round(totals.km))}</td>
                <td className="num">{f.decimal(totals.volume)}</td>
                {showMoney && <>
                  <td className="num">{f.money(totals.fuel)}</td>
                  <td className="num">{f.money(totals.repairs)}</td>
                  <td className="num">{f.money(totals.fuel + totals.repairs)}</td>
                  <td className="num">{perDistance(totals.fuel + totals.repairs, totals.km)}</td>
                </>}
                <td className="num">{f.economyText(f.economy(totals.km, totals.volume))}</td>
              </tr>
            </Table>
            {totals.km === 0 && (
              <p className="border-t border-line px-4 py-2 text-[12px] text-fg-muted">
                Distance needs at least two odometer readings.{editable && <> Log fuel with the odometer, or <Link href={`/fleet/${truck.id}#readings`} className="font-medium text-fg hover:underline">update the reading</Link> regularly.</>}
              </p>
            )}
          </Card>

          <Card id="fuel-log" className="scroll-mt-20" title="Fuel log" flush actions={recentFills.length > 0 && <span className="text-[11px] text-fg-subtle">Last {recentFills.length} fills</span>}>
            {recentFills.length > 0 && (
              <Table dense stickyHead={false} head={["Date", "Station", volumeTitle, ...(showMoney ? ["Cost", `Per ${vol}`] : []), "Odometer", "Driver"]}>
                {recentFills.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-fg-muted">{f.date(x.date)}</td>
                    <td className="max-w-40 truncate">{x.station ?? "—"}</td>
                    <td className="num">{f.decimal(x.liters)}</td>
                    {showMoney && <>
                      <td className="num">{f.money2(x.cost)}</td>
                      <td className="num text-fg-muted">{x.liters ? f.money3(x.cost / x.liters) : "—"}</td>
                    </>}
                    <td className="num text-fg-muted">{x.odometerKm ? f.dist(x.odometerKm) : "—"}</td>
                    <td className="text-fg-muted">{x.driver?.name ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
            {recentFills.length === 0 && (
              <EmptyState icon={<Fuel />} title="No fuel logged yet"
                description={editable ? `Log fills on the right. With the odometer on each fill you get ${f.labels.economy}, cost per ${f.labels.distance} and measured ${f.labels.distanceLong}.` : "Fuel fills appear here once someone logs them."} />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {editable && (
            <Card title={<span className="flex items-center gap-1.5">Log fuel<InfoTip>An odometer reading higher than the truck&apos;s moves the truck&apos;s odometer forward.</InfoTip></span>}>
              <ActionForm action={addFuelLog.bind(null, truck.id)} resetOnSuccess className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Volume (${vol})`} required><Input name="liters" type="number" step="0.001" min={0} required className="num" /></Field>
                  <Field label={`Cost (${f.currency})`} required><Input name="cost" type="number" step="0.01" min={0} required className="num" /></Field>
                  <Field label={`Odometer (${f.labels.distance})`}><Input name="odometerKm" type="number" min={0} placeholder={String(truck.odometerKm)} className="num" /></Field>
                  <Field label="Date"><Input name="date" type="date" defaultValue={f.dateInput(now)} max={f.dateInput(now)} /></Field>
                </div>
                <Field label="Station"><Input name="station" placeholder="Station and city" /></Field>
                <SubmitButton variant="secondary" className="w-full" pendingText="Logging…"><Plus />Log fuel</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {lease && (
            <Card title="Lease mileage" actions={<Badge value={lease.state.toUpperCase()} tone={lease.tone} label={lease.state === "over" ? "Over cap" : lease.state === "buffer" ? "In buffer" : lease.state === "near" ? "Near cap" : "Within limit"} />}>
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <p className="eyebrow">{lease.overKm > 0 ? "Over hard cap" : "Left to hard cap"}</p>
                  <p className={cn("num mt-1 text-[22px] font-semibold leading-none", lease.tone === "danger" ? "text-danger" : lease.tone === "warn" ? "text-warn" : "text-fg")}>{f.dist(lease.overKm > 0 ? lease.overKm : lease.remainingKm)}</p>
                </div>
                {showMoney && (
                  <div className="text-right">
                    <p className="eyebrow">Exposure</p>
                    <p className={cn("num mt-1 text-[18px] font-semibold leading-none", lease.exposure > 0 ? "text-danger" : "text-fg-muted")}>{f.money(lease.exposure)}</p>
                  </div>
                )}
              </div>
              <Progress value={lease.pct} tone={lease.tone} marker={lease.allowedMarker} className="mb-1" />
              <div className="mb-3 flex justify-between text-[10px] text-fg-subtle"><span>start</span><span>limit</span><span>hard cap</span></div>
              <DL items={[
                ["Lessor", lease.lessor ?? "—"],
                ["Lease start", <span key="s" className="num">{f.dist(lease.startKm)}</span>],
                ["Annual limit", <span key="a" className="num">{f.dist(lease.limitKm)}</span>],
                ["Buffer", <span key="b" className="num">{lease.bufferPct}%</span>],
                ["Allowed", <span key="al" className="num">{f.dist(lease.allowedKm)}</span>],
                ["Hard cap", <span key="h" className="num">{f.dist(lease.hardCapKm)}</span>],
                ["Current", <span key="c" className="num">{f.dist(truck.odometerKm)}</span>],
                ...(showMoney ? [["Overage rate", <span key="r" className="num">{f.money2(lease.rate)} {f.labels.perDistance}</span>] as [string, React.ReactNode]] : []),
              ]} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
