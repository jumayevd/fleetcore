import { requireUser } from "@/lib/auth";
import { saveLoad } from "@/app/actions/loads";
import { PageHeader } from "@/components/ui";
import { CITIES } from "@/lib/constants";
import { LoadForm } from "../load-form";
import { assignmentOptions } from "../options";
import type { StopDefault } from "../stops-editor";
import { zonedAt } from "../tz";

export const metadata = { title: "New load" };

export default async function NewLoadPage({ searchParams }: PageProps<"/loads/new">) {
  await requireUser("loads.edit");
  const sp = await searchParams;
  const options = await assignmentOptions();

  // Sensible defaults: pick up tomorrow 08:00 company time (not the server's zone), deliver the day after.
  const pickup = zonedAt(1, 8);
  const pickupEnd = new Date(pickup.getTime() + 4 * 3_600_000);
  const deliveryEnd = new Date(pickup.getTime() + 34 * 3_600_000);
  const city = (name: string) => CITIES.find((c) => c.name === name)!;
  const tashkent = city("Tashkent");
  const samarkand = city("Samarkand");
  const stops: StopDefault[] = [
    { type: "PICKUP", name: "", city: tashkent.name, lat: tashkent.lat, lng: tashkent.lng, address: null, windowStart: pickup.toISOString(), windowEnd: pickupEnd.toISOString(), notes: null },
    { type: "DELIVERY", name: "", city: samarkand.name, lat: samarkand.lat, lng: samarkand.lng, address: null, windowStart: null, windowEnd: deliveryEnd.toISOString(), notes: null },
  ];
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  return (
    <>
      <PageHeader eyebrow="Loads" title="New load" subtitle="Book a shipment: stops, cargo and price now; assign a unit now or later from the board." />
      <LoadForm action={saveLoad.bind(null, null)} options={options} stops={stops}
        defaults={{ customerId: pick("customer"), brokerId: pick("broker"), teamId: pick("team") }} />
    </>
  );
}
