import { ClipboardList, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { date } from "@/lib/format";
import { LinkButton, PageHeader, Segmented, Tabs } from "@/components/ui";
import {
  fleetUnits, lastPmJobs, leaseRows, openPmWorkOrders, parsePeriod, parseTab, periodRange, PERIODS, pmRows, str, TAB_LABELS, TABS, unitCompliance,
  unitsInShopCount, type PeriodKey, type TabKey,
} from "./_lib/data";
import { maintenanceHref, newWorkOrderHref } from "./_lib/links";
import { SummaryTab } from "./_components/tab-summary";
import { LogTab } from "./_components/tab-log";
import { PmTab } from "./_components/tab-pm";
import { LeaseTab } from "./_components/tab-lease";
import { ShopTab } from "./_components/tab-shop";
import { ComplianceTab } from "./_components/tab-compliance";

export const metadata = { title: "Maintenance" };

const SUBTITLE: Record<TabKey, string> = {
  summary: "Spend, cost per km and where the money goes.",
  log: "Every completed repair with shop time and cost.",
  pm: "Preventive maintenance by odometer, worst first.",
  lease: "Mileage caps on leased tractors and what going over would cost.",
  shop: "Units off the road right now and how long they have been out.",
  compliance: "Registration, insurance and inspection paperwork per unit.",
};

export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  const user = await requireUser("fleet.view");
  const editable = can(user.role, "fleet.edit");
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const period = parsePeriod(sp.period);
  const periodic = tab === "summary" || tab === "log";

  const { trucks, trailers } = await fleetUnits();
  const [openPm, inShop, compliance, lastPm] = await Promise.all([
    openPmWorkOrders(),
    // Units, not jobs: two jobs on one truck are one unit off the road.
    unitsInShopCount(),
    unitCompliance(trucks, trailers),
    // Last PM job (cost, shop) is only shown on the PM board.
    tab === "pm" ? lastPmJobs(trucks.map((t) => t.id)) : undefined,
  ]);
  const pm = pmRows(trucks, openPm, lastPm);
  const lease = leaseRows(trucks);
  const counts: Partial<Record<TabKey, number>> = {
    pm: pm.filter((r) => r.kmLeft != null && r.kmLeft < 0).length,
    lease: lease.totals.overCount,
    shop: inShop,
    compliance: compliance.issues,
  };
  const range = periodRange(period);
  const href = (patch: { tab?: TabKey; period?: PeriodKey }) => maintenanceHref({ tab: patch.tab ?? tab, period: patch.period ?? period });

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Maintenance"
        subtitle={periodic ? <>{SUBTITLE[tab]} <span className="num text-fg-subtle">{date(range.from)} – {date(range.to)}</span></> : SUBTITLE[tab]}
        actions={
          <>
            {periodic && (
              <Segmented active={period} items={(Object.keys(PERIODS) as PeriodKey[]).map((p) => ({ key: p, label: PERIODS[p].label, href: href({ period: p }) }))} />
            )}
            <LinkButton href="/maintenance/work-orders" variant="secondary"><ClipboardList />Work orders</LinkButton>
            {editable && <LinkButton href={newWorkOrderHref()}><Plus />New work order</LinkButton>}
          </>
        }
      />

      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t, label: TAB_LABELS[t], href: href({ tab: t }), count: counts[t] || undefined }))} />

      {tab === "summary" && <SummaryTab period={period} trucks={trucks} trailers={trailers} />}
      {tab === "log" && <LogTab period={period} trucks={trucks} trailers={trailers} filters={{ category: str(sp.category), vendor: str(sp.vendor), unit: str(sp.unit) }} />}
      {tab === "pm" && <PmTab rows={pm} editable={editable} />}
      {tab === "lease" && <LeaseTab trucks={trucks} />}
      {tab === "shop" && <ShopTab editable={editable} />}
      {tab === "compliance" && <ComplianceTab data={compliance} />}
    </>
  );
}
