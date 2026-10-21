import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fleetSnapshot } from "@/lib/telemetry";
import { isFleetStatus } from "@/components/map/fleet-status";
import { TrackingBoard } from "@/components/live-fleet";

export const metadata = { title: "Live map" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Where every truck in service is, with its status, driver, fuel and oil service, in the company's units and time zone.
 * Trucks held out of service by a defect show apart (red stop marker, the defect and how it is released). Deep links:
 * `?truck=<id>` selects a truck, `?status=rolling|idle|stopped|shop|oos|nosignal` and `?group=<name>` (or `none`)
 * pre-filter the list.
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
