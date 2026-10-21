import { requireUser } from "@/lib/auth";
import { fleetSnapshot } from "@/lib/telemetry";
import { TrackingBoard } from "@/components/live-fleet";

export const metadata = { title: "Live map" };

export default async function TrackingPage({ searchParams }: PageProps<"/tracking">) {
  await requireUser("tracking.view");
  const sp = await searchParams;
  const truck = typeof sp.truck === "string" ? sp.truck : null;
  const fleet = await fleetSnapshot();
  return <TrackingBoard initial={fleet} at={new Date().toISOString()} selectedId={truck} />;
}
