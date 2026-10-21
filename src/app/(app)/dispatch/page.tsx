import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { FilterPills, InfoTip, LinkButton, PageHeader, Segmented } from "@/components/ui";
import { DateNav } from "./date-nav";
import { DispatchBoard } from "./board";
import { PrebookView } from "./prebook";
import { loadBoardRows, parseBoardDate, prebookLoads, todayYmd } from "./board-data";
import { ymdLong } from "./dates";
import type { BoardView } from "./types";

export const metadata = { title: "Dispatch board" };

export default async function DispatchPage({ searchParams }: PageProps<"/dispatch">) {
  const user = await requireUser("loads.view");
  const sp = await searchParams;
  const view: BoardView = sp.view === "flat" ? "flat" : sp.view === "prebook" ? "prebook" : "teams";
  const date = parseBoardDate(sp.date);
  const today = todayYmd();
  const team = typeof sp.team === "string" && sp.team ? sp.team : null;
  const q = typeof sp.q === "string" ? sp.q : "";
  const focusDriver = typeof sp.driver === "string" ? sp.driver : null;
  const canEdit = can(user.role, "board.edit");

  const teams = await db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, _count: { select: { drivers: { where: { status: { not: "INACTIVE" } } } } } } });
  const qs = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { view: view === "teams" ? undefined : view, date: date === today ? undefined : date, team, q: q || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/dispatch${s ? `?${s}` : ""}`;
  };

  const dayLabel = ymdLong(date);
  const dayHint = date === today ? "Today" : date < today ? "Past day — status shown as it was at end of day" : "Upcoming day — planned loads";

  const [board, prebook] = await Promise.all([
    view === "prebook" ? null : loadBoardRows(date, { teamId: team }),
    view === "prebook" ? prebookLoads() : null,
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Dispatch"
        title={view === "prebook" ? "Prebook board" : "Daily board"}
        subtitle={view === "prebook"
          ? <span className="inline-flex items-center gap-1.5">Pickups more than 24 hours out<InfoTip>Drivers reserved here stay ready on today&apos;s board until the pickup is inside 24 hours.</InfoTip></span>
          : <span className="inline-flex items-center gap-1.5">{dayLabel}{date === today ? <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium leading-[18px] text-accent-text">Today</span> : <InfoTip>{dayHint}</InfoTip>}</span>}
        actions={
          <>
            {view !== "prebook" && <DateNav date={date} today={today} />}
            <Segmented active={view} items={[
              { key: "teams", label: "Teams", href: qs({ view: undefined }) },
              { key: "flat", label: "Flat", href: qs({ view: "flat" }) },
              { key: "prebook", label: "Prebook", href: qs({ view: "prebook", date: undefined }) },
            ]} />
            {can(user.role, "loads.edit") && <LinkButton href="/loads/new" size="sm"><Plus />New load</LinkButton>}
          </>
        }
      />

      {board && (
        <DispatchBoard key={`${date}:${team ?? ""}:${view}`} initial={board} view={view === "flat" ? "flat" : "teams"} canEdit={canEdit} team={team} initialQ={q} focusDriverId={focusDriver}
          teamFilter={(
            <FilterPills active={team ?? "all"} items={[
              { key: "all", label: "All teams", href: qs({ team: undefined }) },
              ...teams.map((t) => ({
                key: t.id, href: qs({ team: t.id }), count: t._count.drivers,
                label: <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color ?? "var(--fg-faint)" }} />{t.name}</span>,
              })),
              { key: "none", label: "No team", href: qs({ team: "none" }) },
            ]} />
          )} />
      )}
      {prebook && <PrebookView loads={prebook.loads} total={prebook.total} limit={prebook.limit} now={prebook.at} teams={teams} canAssign={can(user.role, "loads.edit")} showMoney={can(user.role, "finance.view") || can(user.role, "loads.edit")} />}
    </>
  );
}
