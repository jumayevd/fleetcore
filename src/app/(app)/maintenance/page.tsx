import { redirect } from "next/navigation";
import { Droplet, Plus, Store } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFormat } from "@/lib/format-server";
import { LinkButton, PageHeader, Segmented, Tabs } from "@/components/ui";
import { fleetUnits, leaseRows, parsePeriod, parseTab, periodRange, PERIODS, str, TAB_LABELS, TABS, unitCompliance, unitsInShopCount, type PeriodKey, type TabKey } from "./_lib/data";
import { maintenanceHref, newWorkOrderHref } from "./_lib/links";
import { SummaryTab } from "./_components/tab-summary";
import { LogTab } from "./_components/tab-log";
import { LeaseTab } from "./_components/tab-lease";
import { ShopTab } from "./_components/tab-shop";
import { ComplianceTab } from "./_components/tab-compliance";

export const metadata = { title: "Shop overview" };

const SUBTITLE: Record<TabKey, string> = {
  summary: "What the shop costs, where the money goes and how long units are off the road.",
  log: "Every completed repair with its shop time.",
  shop: "Units off the road right now and how long they have been out.",
  lease: "Mileage caps on leased tractors and what going over would cost.",
  compliance: "Registration, insurance and inspection paperwork per unit.",
};

export default async function ShopOverview({ searchParams }: PageProps<"/maintenance">) {
  const user = await requireUser("fleet.view");
  const sp = await searchParams;
  // The PM schedule moved to its own page.
  if (str(sp.tab) === "pm") redirect("/maintenance/oil");
  const editable = can(user.role, "fleet.edit");
  const money = can(user.role, "money.view");
  const f = await getFormat();
  const tab = parseTab(sp.tab);
  const period = parsePeriod(sp.period);
  const periodic = tab === "summary" || tab === "log";

  const { trucks, trailers } = await fleetUnits();
  const [inShop, compliance] = await Promise.all([unitsInShopCount(), unitCompliance(trucks, trailers)]);
  const lease = leaseRows(trucks);
  const counts: Partial<Record<TabKey, number>> = { lease: lease.totals.overCount, shop: inShop, compliance: compliance.issues };
  const range = periodRange(period);
  const href = (patch: { tab?: TabKey; period?: PeriodKey }) => maintenanceHref({ tab: patch.tab ?? tab, period: patch.period ?? period });

  return (
    <>
      <PageHeader
        title="Shop overview"
        subtitle={periodic ? <>{SUBTITLE[tab]} <span className="num text-fg-subtle">{f.date(range.from)} – {f.date(range.to)}</span></> : SUBTITLE[tab]}
        actions={
          <>
            {periodic && <Segmented active={period} items={(Object.keys(PERIODS) as PeriodKey[]).map((p) => ({ key: p, label: PERIODS[p].label, href: href({ period: p }) }))} />}
            <LinkButton href="/maintenance/oil" variant="secondary"><Droplet />Oil changes</LinkButton>
            <LinkButton href="/vendors" variant="secondary"><Store />Vendors</LinkButton>
            {editable && <LinkButton href={newWorkOrderHref()}><Plus />New repair</LinkButton>}
          </>
        }
      />

      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t, label: TAB_LABELS[t], href: href({ tab: t }), count: counts[t] || undefined }))} />

      {tab === "summary" && <SummaryTab period={period} trucks={trucks} trailers={trailers} money={money} />}
      {tab === "log" && <LogTab period={period} trucks={trucks} trailers={trailers} money={money} filters={{ category: str(sp.category), type: str(sp.type), vendor: str(sp.vendor), unit: str(sp.unit) }} />}
      {tab === "shop" && <ShopTab money={money} />}
      {tab === "lease" && <LeaseTab trucks={trucks} money={money} />}
      {tab === "compliance" && <ComplianceTab data={compliance} />}
    </>
  );
}
