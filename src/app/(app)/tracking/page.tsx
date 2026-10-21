import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fleetSnapshot } from "@/lib/telemetry";
import { isFleetStatus } from "@/components/map/fleet-status";
import { TrackingBoard } from "@/components/live-fleet";

export const metadata = { title: "Live map" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Where every truck in service is, with its status, driver, fuel and PM. Deep links: `?truck=<id>` selects a truck,
 * `?status=rolling|idle|stopped|shop|nosignal` and `?group=<name>` (or `none`) pre-filter the list.
 */
export default async function TrackingPage({ searchParams }: PageProps<"/tracking">) {
  const user = await requireUser("tracking.view");
  const sp = await searchParams;
  const status = str(sp.status);
  const fleet = await fleetSnapshot();
  return (
    <TrackingBoard
      initial={fleet}
      at={new Date().toISOString()}
      selectedId={str(sp.truck) ?? null}
      initialStatus={isFleetStatus(status) ? status : "all"}
      initialGroup={str(sp.group) ?? "all"}
      canEdit={can(user.role, "fleet.edit")}
    />
  );
}
