import { Download, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { money, money2, number } from "@/lib/format";
import { buttonClass, Card, EmptyState, InfoTip, LinkButton, PageHeader, Stat } from "@/components/ui";
import { WeekPicker } from "./week-picker";
import { GoalsControl } from "./goals";
import { WeeklyBoard } from "./weekly-board";
import { parseWeek, thisWeekMonday, weeklyProductionTz } from "./weekly-data";
import { shiftYmd, todayYmd, ymdDayMonth, ymdDayMonthYear } from "../dates";

export const metadata = { title: "Weekly production" };

export default async function WeeklyPage({ searchParams }: PageProps<"/dispatch/weekly">) {
  const user = await requireUser("loads.view");
  const sp = await searchParams;
  // Strict YYYY-MM-DD (a real date) in company time; anything else, e.g. ?week=1, shows this week instead of failing.
  const weekYmd = parseWeek(sp.week);
  const data = await weeklyProductionTz(weekYmd);
  const today = todayYmd();
  const thisWeekYmd = thisWeekMonday();
  const canManage = can(user.role, "users.manage");

  const goalTotal = data.groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.goal, 0), 0);
  const loadsCount = data.groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.days.reduce((c, d) => c + d.loads.length, 0), 0), 0);
  const worked = data.groups.reduce((a, g) => a + g.rows.filter((r) => r.daysWorked > 0).length, 0);
  const planPct = goalTotal ? Math.round((data.grand.total / goalTotal) * 100) : 0;
  const rangeLabel = `${ymdDayMonth(weekYmd)} – ${ymdDayMonthYear(shiftYmd(weekYmd, 6))}`;

  return (
    <>
      <PageHeader
        eyebrow="Dispatch"
        title="Weekly production"
        subtitle={(
          <span className="inline-flex items-center gap-1.5">
            <span className="num">{rangeLabel}</span>
            {weekYmd === thisWeekYmd && <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium leading-[18px] text-accent-text">This week</span>}
            <InfoTip>Revenue per driver per day. Loads count on their pickup day{weekYmd === thisWeekYmd ? "; this week is still in progress" : ""}.</InfoTip>
          </span>
        )}
        actions={
          <>
            <WeekPicker week={weekYmd} thisWeek={thisWeekYmd} />
            <GoalsControl goals={data.goals} canManage={canManage} />
            <a href={`/api/export/weekly?week=${weekYmd}`} download className={buttonClass("secondary", "sm")}><Download />Export CSV</a>
            {can(user.role, "loads.edit") && <LinkButton href="/loads/new" size="sm"><Plus />New load</LinkButton>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total revenue" value={money(data.grand.total)} hint={`of ${money(goalTotal)} planned`} delta={goalTotal ? `${planPct >= 100 ? "+" : "−"}${Math.abs(planPct - 100)}% vs plan` : undefined} deltaTone={planPct >= 100 ? "ok" : planPct >= 70 ? "warn" : "danger"} />
        <Stat label="Total distance" value={`${number(Math.round(data.grand.km))} km`} hint={`${loadsCount} ${loadsCount === 1 ? "load" : "loads"} picked up`} />
        <Stat label="Revenue per km" value={money2(data.grand.rpk)} hint="rate ÷ loaded km" />
        <Stat label="Average per driver" value={money(data.grand.avgPerTruck)} hint={`${worked} of ${data.grand.drivers} drivers worked`} />
        <Stat label="Drivers on the board" value={data.grand.drivers} hint={`${data.groups.length} ${data.groups.length === 1 ? "team" : "teams"} · goals ${money(data.goals.solo)} solo / ${money(data.goals.team)} team`} />
      </div>

      {loadsCount === 0 ? (
        <Card>
          <EmptyState
            title="No production in this week"
            description="Nothing was picked up between these dates. Pick another week, or book a load — it will show up here on its pickup day."
            action={
              <div className="flex gap-2">
                {weekYmd !== thisWeekYmd && <LinkButton href="/dispatch/weekly" variant="secondary" size="sm">This week</LinkButton>}
                {can(user.role, "loads.edit") && <LinkButton href="/loads/new" size="sm">New load</LinkButton>}
              </div>
            }
          />
        </Card>
      ) : (
        <WeeklyBoard groups={data.groups} days={data.days} today={today} grand={data.grand} goalTotal={goalTotal} />
      )}
    </>
  );
}
