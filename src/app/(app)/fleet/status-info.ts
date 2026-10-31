import type { Formatter } from "@/lib/locale";
import type { InactiveInfo } from "./truck-status-change";

/** An inactive truck's record for the status pill and the truck page, in the company's formats. */
export function inactiveInfo(
  t: { statusReason: string | null; statusNote: string | null; statusSince: Date | null; odometerKm: number },
  f: Formatter,
  by?: string | null,
): InactiveInfo {
  return {
    reason: t.statusReason,
    note: t.statusNote,
    since: t.statusSince ? f.date(t.statusSince) : null,
    sinceInput: t.statusSince ? f.dateInput(t.statusSince) : null,
    by: by ?? null,
    odometer: t.odometerKm ? f.dist(t.odometerKm) : null,
  };
}
