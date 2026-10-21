import "server-only";
import { can, canOpen } from "@/lib/permissions";
import { getAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import type { ShellData } from "@/components/app-shell";

/**
 * The alert bell and nav counts for the active company (GET /api/shell). A failure here must never take a page down,
 * so it degrades to empty.
 */
export async function loadShellData(role: string): Promise<ShellData> {
  try {
    const [allAlerts, overdueWork] = await Promise.all([
      can(role, "dashboard.view") ? getAlerts() : Promise.resolve([]),
      can(role, "fleet.view") ? db.workOrder.count({ where: { status: { in: ["DRAFT", "OPEN"] }, voidedAt: null, scheduledAt: { lt: new Date() } } }) : Promise.resolve(0),
    ]);
    // The bell only lists alerts this role can act on (same rule as the Today page).
    const alerts = allAlerts.filter((a) => canOpen(role, a.href));
    const badges: Record<string, number> = {};
    if (overdueWork) badges["/maintenance/work-orders"] = overdueWork;
    return { alerts, badges };
  } catch (e) {
    console.error("shell data failed", e);
    return { alerts: [], badges: {} };
  }
}
