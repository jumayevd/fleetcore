"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, LoaderCircle, MapPin, Phone, Store } from "lucide-react";
import { VENDOR_TYPE_LABELS } from "@/lib/constants";
import { ago } from "@/lib/format";
import { Button, cn, segmentedThumb, segmentedTrack } from "@/components/ui";
import { useFormat } from "@/components/locale";
import { Overlay } from "@/components/inspections/overlay";
import { sourceLabel } from "@/components/map/fleet-status";
import { vendorsNear, type NearVendor, type VendorsNearResult } from "@/app/actions/vendors";

type Sort = "closest" | "visited";

/**
 * "Vendors near this truck" on the repair form: a dialog (the form stays where it is) listing the company's vendors by
 * how far they are from the truck's last position (ELD / tracker), or by how often they were used, with the miles to
 * each. Picking one fills in the Shop.
 */
export function VendorsNear({ truckId, unitNumber, selectedId, onPick }: {
  truckId: string; unitNumber: string; selectedId: string; onPick: (vendorId: string) => void;
}) {
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VendorsNearResult | null>(null);
  const [sort, setSort] = useState<Sort>("closest");
  const [pending, start] = useTransition();

  const load = () => {
    setOpen(true);
    setData(null);
    start(async () => {
      try { setData(await vendorsNear(truckId)); } catch { setData({ error: "Could not load the vendors. Try again." }); }
    });
  };
  const rows = useMemo(() => {
    const byVisits = (a: NearVendor, b: NearVendor) => b.visits - a.visits || b.truckVisits - a.truckVisits;
    const byDistance = (a: NearVendor, b: NearVendor) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    return [...(data?.vendors ?? [])].sort((a, b) =>
      (sort === "closest" ? byDistance(a, b) || byVisits(a, b) : byVisits(a, b) || byDistance(a, b)) || a.name.localeCompare(b.name));
  }, [data, sort]);
  const mostUsed = Math.max(0, ...(data?.vendors ?? []).map((v) => v.visits));
  const t = data?.truck;

  return (
    <>
      <Button variant="secondary" onClick={load} className="w-full justify-center sm:w-auto"><MapPin />Vendors near {unitNumber}</Button>
      {/* Rendered into <body>; stop its clicks bubbling into the form around the button. */}
      <span className="contents" onClick={(e) => e.stopPropagation()}>
        <Overlay variant="dialog" wide open={open} onClose={() => setOpen(false)} title={`Vendors near ${unitNumber}`}
          subtitle={t ? (t.located ? `From its last position: ${t.locationName ?? "on the map"}${t.at ? `, ${ago(t.at)}` : ""} · ${sourceLabel(t.source)}` : "No position for this truck yet") : "Finding the truck…"}
          footer={
            <p className="text-[11px] text-fg-subtle">
              Straight-line {f.labels.distanceLong} from the truck&apos;s last position; by road it is a little further. A vendor needs an address or a known city to have a distance: add it on its page under Vendors.
            </p>
          }>
          {pending || !data ? (
            <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-fg-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Working out the distances…</p>
          ) : data.error ? (
            <p role="alert" className="py-6 text-center text-[13px] text-danger">{data.error}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-fg-muted">No vendors yet. Add the shops you use under Vendors, or create one from the Shop field.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className={segmentedTrack} role="group" aria-label="Sort vendors">
                  <button type="button" onClick={() => setSort("closest")} aria-pressed={sort === "closest"} className={segmentedThumb(sort === "closest")}>Closest</button>
                  <button type="button" onClick={() => setSort("visited")} aria-pressed={sort === "visited"} className={segmentedThumb(sort === "visited")}>Most used</button>
                </div>
                {!t?.located && <span className="text-[12px] text-warn">{unitNumber} has no position yet, so there are no distances.</span>}
              </div>
              <ul className="divide-y divide-line rounded-md border border-line">
                {rows.map((v) => {
                  const picked = v.id === selectedId;
                  return (
                    <li key={v.id} className={cn("flex items-center gap-3 px-3 py-2.5", picked && "bg-accent-soft/50")}>
                      <div className="w-20 shrink-0 text-right">
                        {v.distanceKm != null ? (
                          <>
                            <p className="num text-[15px] font-semibold leading-tight text-fg">{f.dist(v.distanceKm)}</p>
                            <p className="text-[10.5px] text-fg-subtle">{v.precision === "CITY" ? "from its city" : "away"}</p>
                          </>
                        ) : <p className="text-[11px] leading-tight text-fg-faint">{v.precision ? "—" : "no location"}</p>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-fg">
                          <Store className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                          <span className="truncate">{v.name}</span>
                          {v.visits > 0 && v.visits === mostUsed && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-px text-[10px] font-medium text-accent-text">Most used</span>}
                        </p>
                        <p className="truncate text-[11.5px] text-fg-subtle">
                          {[VENDOR_TYPE_LABELS[v.type] ?? v.type, [v.address, v.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ")}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-fg-muted">
                          <span>{v.visits ? `${v.visits} repair${v.visits === 1 ? "" : "s"}${v.truckVisits ? ` · ${v.truckVisits} on ${unitNumber}` : ""}${v.lastVisit ? ` · last ${f.day(v.lastVisit)}` : ""}` : "Not used yet"}</span>
                          {v.phone && <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="num inline-flex items-center gap-1 hover:text-fg hover:underline"><Phone className="h-3 w-3" />{v.phone}</a>}
                        </p>
                      </div>
                      <Button size="sm" variant={picked ? "secondary" : "primary"} disabled={picked} onClick={() => { onPick(v.id); setOpen(false); }}>
                        {picked ? <><Check />Picked</> : "Pick"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Overlay>
      </span>
    </>
  );
}
