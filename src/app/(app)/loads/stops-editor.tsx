"use client";

import { ArrowDown, ArrowUp, Crosshair, Plus, X } from "lucide-react";
import { CITIES } from "@/lib/constants";
import { roadKm, type LatLng } from "@/lib/geo";
import { number } from "@/lib/format";
import { Badge, Chip, IconButton, buttonClass, cn, inputClass } from "@/components/ui";
import { STOP_TONE, STOP_TYPE_LABEL, STOP_TYPE_TONE } from "./shared";
import { ZONE_LABEL, fromZonedInput, sameZonedDay, toZonedInput, zonedDateTime, zonedTime } from "./tz";

export type StopDraft = {
  key: string;
  type: "PICKUP" | "DELIVERY";
  name: string;
  city: string;
  /** Coordinates typed by hand instead of picked from the city list. */
  custom: boolean;
  lat: string;
  lng: string;
  address: string;
  /** ISO instants ("" when unset). Shown and typed as company time; submitted as ISO so the server never guesses a zone. */
  windowStart: string;
  windowEnd: string;
  notes: string;
  /** Execution status when editing an existing load (PENDING | ARRIVED | DONE). */
  status?: string;
};

/** What the server stores; the form turns it into drafts. Dates are ISO strings so it crosses the RSC boundary. */
export type StopDefault = {
  type: string; name: string; city: string; lat: number; lng: number; address: string | null;
  windowStart: string | null; windowEnd: string | null; notes: string | null; status?: string;
};

export function stopCoords(s: StopDraft): LatLng | null {
  if (s.custom) {
    const lat = Number(s.lat), lng = Number(s.lng);
    return s.lat !== "" && s.lng !== "" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const c = CITIES.find((x) => x.name === s.city);
  return c ? { lat: c.lat, lng: c.lng } : null;
}

let seq = 0;
export function newStop(type: StopDraft["type"], patch: Partial<StopDraft> = {}): StopDraft {
  return { key: `n${++seq}`, type, name: "", city: "", custom: false, lat: "", lng: "", address: "", windowStart: "", windowEnd: "", notes: "", ...patch };
}

export function toDraft(s: StopDefault, i: number): StopDraft {
  const known = CITIES.find((c) => c.name === s.city);
  const custom = !known || Math.abs(known.lat - s.lat) > 0.01 || Math.abs(known.lng - s.lng) > 0.01;
  return {
    key: `s${i}`, type: s.type === "DELIVERY" ? "DELIVERY" : "PICKUP", name: s.name, city: s.city, custom,
    lat: custom ? String(s.lat) : "", lng: custom ? String(s.lng) : "", address: s.address ?? "",
    windowStart: s.windowStart ?? "", windowEnd: s.windowEnd ?? "", notes: s.notes ?? "", status: s.status,
  };
}

const windowInvalid = (s: StopDraft) => Boolean(s.windowStart && s.windowEnd && new Date(s.windowEnd) < new Date(s.windowStart));

/** "05 Oct, 08:00 – 12:00", "05 Oct, 08:00 – 06 Oct, 18:00", "by 06 Oct, 18:00" — company time, identical on server and client. */
function lockedWindow(s: StopDraft) {
  if (s.windowStart && s.windowEnd) {
    return `${zonedDateTime(s.windowStart)} – ${sameZonedDay(s.windowStart, s.windowEnd) ? zonedTime(s.windowEnd) : zonedDateTime(s.windowEnd)}`;
  }
  if (s.windowStart) return `from ${zonedDateTime(s.windowStart)}`;
  if (s.windowEnd) return `by ${zonedDateTime(s.windowEnd)}`;
  return "No window";
}

/**
 * Ordered pickups and deliveries. Emits the parallel arrays saveLoad expects
 * (stopType[], stopName[], stopCity[], stopLat[], stopLng[], stopWindowStart[], stopWindowEnd[], stopAddress[], stopNotes[]),
 * so every stop always submits every field (hidden "" when not applicable) to keep the arrays aligned.
 */
export function StopsEditor({ stops, onChange, locked }: { stops: StopDraft[]; onChange: (next: StopDraft[]) => void; locked?: boolean }) {
  const update = (i: number, patch: Partial<StopDraft>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(stops.filter((_, j) => j !== i));
  const add = (type: StopDraft["type"]) => {
    const prev = stops[stops.length - 1];
    const base = prev?.windowEnd || prev?.windowStart;
    const start = base ? new Date(new Date(base).getTime() + 6 * 3_600_000) : null;
    const draft = newStop(type, {
      windowStart: type === "PICKUP" && start ? start.toISOString() : "",
      windowEnd: start ? new Date(start.getTime() + (type === "PICKUP" ? 4 : 8) * 3_600_000).toISOString() : "",
    });
    if (type === "PICKUP") {
      const lastPickup = stops.map((s) => s.type).lastIndexOf("PICKUP");
      const next = [...stops];
      next.splice(lastPickup + 1, 0, draft);
      onChange(next);
    } else onChange([...stops, draft]);
  };
  const coords = stops.map(stopCoords);

  if (locked) {
    return (
      <ol className="divide-y divide-line">
        {stops.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 px-4 py-2.5">
            <HiddenStop s={s} />
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-fg-muted">{i + 1}</span>
            <Chip tone={STOP_TYPE_TONE[s.type]}>{STOP_TYPE_LABEL[s.type]}</Chip>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{s.name || s.city}</p>
              <p className="truncate text-[11px] text-fg-subtle">{s.city}{s.address && ` · ${s.address}`}</p>
            </div>
            <span className="num hidden text-[12px] text-fg-muted sm:block">
              {lockedWindow(s)}
            </span>
            {s.status && <Badge value={s.status} tone={STOP_TONE[s.status]} />}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="space-y-2 p-3">
      {stops.map((s, i) => {
        const a = coords[i], b = coords[i + 1];
        const leg = a && b ? roadKm(a, b) : null;
        const invalid = windowInvalid(s);
        return (
          <div key={s.key}>
            <div className="flex items-start gap-2 rounded-md border border-line bg-surface p-2.5">
              <span className="num mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-fg-muted" aria-hidden>{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <select name="stopType" aria-label={`Stop ${i + 1} type`} value={s.type} onChange={(e) => update(i, { type: e.target.value as StopDraft["type"] })}
                    className={cn(inputClass, "w-28 pr-7", s.type === "PICKUP" ? "text-info" : "text-accent-text")}>
                    <option value="PICKUP">Pickup</option>
                    <option value="DELIVERY">Delivery</option>
                  </select>
                  <input name="stopName" aria-label={`Stop ${i + 1} location name`} value={s.name} onChange={(e) => update(i, { name: e.target.value })}
                    placeholder={s.city ? `${s.city} ${s.type === "PICKUP" ? "warehouse" : "customer site"}` : "Location name"} className={cn(inputClass, "min-w-44 flex-1")} />
                  {s.custom ? (
                    <>
                      <input name="stopCity" aria-label={`Stop ${i + 1} city`} value={s.city} onChange={(e) => update(i, { city: e.target.value })} placeholder="City" className={cn(inputClass, "w-36")} />
                      <input name="stopLat" aria-label={`Stop ${i + 1} latitude`} type="number" step="any" min={-90} max={90} value={s.lat} onChange={(e) => update(i, { lat: e.target.value })} placeholder="Lat" className={cn(inputClass, "num w-24")} />
                      <input name="stopLng" aria-label={`Stop ${i + 1} longitude`} type="number" step="any" min={-180} max={180} value={s.lng} onChange={(e) => update(i, { lng: e.target.value })} placeholder="Lng" className={cn(inputClass, "num w-24")} />
                    </>
                  ) : (
                    <>
                      <select name="stopCity" aria-label={`Stop ${i + 1} city`} value={s.city} onChange={(e) => update(i, { city: e.target.value })} className={cn(inputClass, "w-44 pr-7", !s.city && "text-fg-faint")}>
                        <option value="">City…</option>
                        {CITIES.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.country})</option>)}
                      </select>
                      <input type="hidden" name="stopLat" value="" />
                      <input type="hidden" name="stopLng" value="" />
                    </>
                  )}
                  <IconButton label={s.custom ? "Pick a city from the list" : "Enter coordinates by hand"} onClick={() => update(i, { custom: !s.custom, lat: "", lng: "" })}
                    className={cn(s.custom && "bg-accent-soft text-accent-text")}>
                    <Crosshair />
                  </IconButton>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input name="stopAddress" aria-label={`Stop ${i + 1} address`} value={s.address} onChange={(e) => update(i, { address: e.target.value })} placeholder="Address, dock or gate (optional)" className={cn(inputClass, "min-w-48 flex-1")} />
                  <input type="datetime-local" aria-label={`Stop ${i + 1} window start (${ZONE_LABEL})`} value={toZonedInput(s.windowStart)} onChange={(e) => update(i, { windowStart: fromZonedInput(e.target.value) })} className={cn(inputClass, "num w-44", invalid && "border-danger")} />
                  <input type="datetime-local" aria-label={`Stop ${i + 1} window end (${ZONE_LABEL})`} value={toZonedInput(s.windowEnd)} onChange={(e) => update(i, { windowEnd: fromZonedInput(e.target.value) })} className={cn(inputClass, "num w-44", invalid && "border-danger")} />
                  <input type="hidden" name="stopWindowStart" value={s.windowStart} />
                  <input type="hidden" name="stopWindowEnd" value={s.windowEnd} />
                  <input name="stopNotes" aria-label={`Stop ${i + 1} notes`} value={s.notes} onChange={(e) => update(i, { notes: e.target.value })} placeholder="Notes for the driver" className={cn(inputClass, "min-w-40 flex-1")} />
                </div>
                {invalid && <p className="text-[11px] text-danger">This window ends before it starts.</p>}
              </div>
              <div className="flex shrink-0 items-center">
                <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconButton>
                <IconButton label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconButton>
                <IconButton label="Remove stop" disabled={stops.length <= 2} onClick={() => remove(i)} className="hover:bg-danger-soft hover:text-danger"><X /></IconButton>
              </div>
            </div>
            {i < stops.length - 1 && (
              <div className="ml-[21px] flex h-6 items-center gap-2 text-[11px] text-fg-subtle" aria-hidden>
                <span className="h-full w-px bg-line-strong" />
                <span className="num">{leg != null ? `${number(leg)} km` : "distance unknown — pick both cities"}</span>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={() => add("PICKUP")} className={buttonClass("secondary", "sm")}><Plus />Add pickup</button>
        <button type="button" onClick={() => add("DELIVERY")} className={buttonClass("secondary", "sm")}><Plus />Add delivery</button>
        <span className="text-[11px] text-fg-subtle">Pickups are inserted after the last pickup; deliveries go to the end. Reorder with the arrows. Windows are in {ZONE_LABEL}.</span>
      </div>
    </div>
  );
}

/** Every field for a stop as hidden inputs (locked loads still submit their stops; windows are ISO instants). */
function HiddenStop({ s }: { s: StopDraft }) {
  return (
    <>
      <input type="hidden" name="stopType" value={s.type} />
      <input type="hidden" name="stopName" value={s.name} />
      <input type="hidden" name="stopCity" value={s.city} />
      <input type="hidden" name="stopLat" value={s.custom ? s.lat : ""} />
      <input type="hidden" name="stopLng" value={s.custom ? s.lng : ""} />
      <input type="hidden" name="stopWindowStart" value={s.windowStart} />
      <input type="hidden" name="stopWindowEnd" value={s.windowEnd} />
      <input type="hidden" name="stopAddress" value={s.address} />
      <input type="hidden" name="stopNotes" value={s.notes} />
    </>
  );
}
