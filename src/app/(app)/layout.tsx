import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { can, canOpen } from "@/lib/permissions";
import { getAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import { CLAIM_OPEN_STATUSES } from "@/lib/constants";
import { daysAgo } from "@/lib/format";
import { NAV_COOKIE } from "@/lib/nav";
import { AppShell, type ShellData } from "@/components/app-shell";
import { AssistantLauncher } from "@/components/assistant/launcher";

/**
 * The alert bell and nav counts. Not awaited by the layout: the promise streams to the shell, which renders at
 * once and fills these in when they arrive. A failure here must never take the page down, so it degrades to empty.
 */
async function loadShellData(role: string): Promise<ShellData> {
  try {
    const [allAlerts, openClaims, unassigned, pinned] = await Promise.all([
      can(role, "dashboard.view") ? getAlerts() : Promise.resolve([]),
      can(role, "claims.view") ? db.claim.count({ where: { status: { in: [...CLAIM_OPEN_STATUSES] } } }) : Promise.resolve(0),
      can(role, "loads.view") ? db.load.count({ where: { status: "PLANNED", pickupAt: { lte: daysAgo(-1) } } }) : Promise.resolve(0),
      can(role, "chat.view") ? db.announcement.count({ where: { pinned: true, OR: [{ expiresAt: null }, { expiresAt: { gt: daysAgo(0) } }] } }) : Promise.resolve(0),
    ]);
    // The bell only lists alerts this role can act on (same rule as the dashboard's "Needs attention").
    const alerts = allAlerts.filter((a) => canOpen(role, a.href));
    const badges: Record<string, number> = {};
    if (openClaims) badges["/claims"] = openClaims;
    if (unassigned) badges["/dispatch"] = unassigned;
    if (pinned) badges["/announcements"] = pinned;
    return { alerts, badges };
  } catch (e) {
    console.error("shell data failed", e);
    return { alerts: [], badges: {} };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const navOpen = (await cookies()).get(NAV_COOKIE)?.value !== "rail";
  // Gate by permission only; the panel/API report "not configured" when the AI Gateway key (or Vercel OIDC) is missing.
  const assistant = can(user.role, "assistant.use");

  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role }} data={loadShellData(user.role)} navOpen={navOpen}>
      {children}
      <AssistantLauncher enabled={assistant} />
    </AppShell>
  );
}
