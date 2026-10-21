import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { can, canOpen } from "@/lib/permissions";
import { getAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import { getSessionContext, listWorkspaces } from "@/lib/session";
import { NAV_COOKIE } from "@/lib/nav";
import { AppShell, type ShellData } from "@/components/app-shell";
import { AssistantLauncher } from "@/components/assistant/launcher";

/**
 * The alert bell and nav counts. Not awaited by the layout: the promise streams to the shell, which renders at
 * once and fills these in when they arrive. A failure here must never take the page down, so it degrades to empty.
 */
async function loadShellData(role: string): Promise<ShellData> {
  try {
    const [allAlerts, overdueWork] = await Promise.all([
      can(role, "dashboard.view") ? getAlerts() : Promise.resolve([]),
      can(role, "fleet.view") ? db.workOrder.count({ where: { status: { in: ["DRAFT", "OPEN"] }, scheduledAt: { lt: new Date() } } }) : Promise.resolve(0),
    ]);
    // The bell only lists alerts this role can act on (same rule as the overview's "Needs attention").
    const alerts = allAlerts.filter((a) => canOpen(role, a.href));
    const badges: Record<string, number> = {};
    if (overdueWork) badges["/maintenance/work-orders"] = overdueWork;
    return { alerts, badges };
  } catch (e) {
    console.error("shell data failed", e);
    return { alerts: [], badges: {} };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ accounts }, jar] = await Promise.all([getSessionContext(), cookies()]);
  const workspaces = await listWorkspaces(accounts);
  const navOpen = jar.get(NAV_COOKIE)?.value !== "rail";
  const active = { userId: user.id, companyId: user.company.id, companyName: user.company.name, color: user.company.color, role: user.role, email: user.email };

  return (
    // Keyed by company: switching company remounts the shell, so no state (open menus, drafts) crosses over.
    <AppShell key={active.companyId + active.userId} user={{ name: user.name, email: user.email, role: user.role }} active={active} accounts={workspaces}
      data={loadShellData(user.role)} navOpen={navOpen}>
      {children}
      {/* One conversation per account × company: switching company never shows another company's chat. */}
      <AssistantLauncher enabled={can(user.role, "assistant.use")} companyId={user.company.id} userId={user.id} />
    </AppShell>
  );
}
