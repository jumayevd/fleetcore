"use client";

import Link from "next/link";
import { useState, useTransition, type KeyboardEvent } from "react";
import { Badge, Progress, cn, inputClass } from "@/components/ui";
import { useFormat } from "@/components/locale";
import type { Formatter } from "@/lib/locale";
import { roLabel, serviceStatus, SERVICE_STATE_LABELS, SERVICE_STATE_TONE, type ServiceStatus } from "@/lib/service";
import { setLastOilChange, setOilShop } from "@/app/actions/oil";
import { readingsHref, truckHref, vendorHref, workOrderHref } from "../_lib/links";
import { TruckTypeSelect } from "./oil-types";

export type OilRowData = {
  id: string;
  unitNumber: string;
  driverName: string | null;
  odometerKm: number;
  odometerAt: string | null;
  /** Driven by GPS since that reading (ELD, straight line between positions): shown with ≈, never used for the countdown. */
  gpsDistance: number;
  pmIntervalKm: number;
  lastPmKm: number | null;
  lastPmAt: string | null;
  nextServiceKm: number | null;
  truckTypeId: string | null;
  truckType: { name: string; oilIntervalKm: number } | null;
  oilShop: string | null;
  booked: { id: string; number: number; inShop: boolean; scheduledAt: string; vendor: { id: string; name: string } | null; vendorName: string | null } | null;
};

/** "1,234,567" / "1234567" / "" → number or null. */
const parseOdo = (v: string) => {
  const digits = v.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
};

/**
 * One truck on the oil board. Editors type the last oil change odometer and the shop straight into the row: while
 * the number is being typed, "used", "due at" and the status are worked out again on the spot; leaving the field
 * (or Enter) saves it, Escape puts it back.
 */
export function OilRow({ t, editable, highlighted, now, types }: {
  t: OilRowData; editable: boolean; highlighted: boolean; now: string; types: { id: string; name: string }[];
}) {
  const f = useFormat();
  const [draft, setDraft] = useState(t.lastPmKm == null ? "" : String(t.lastPmKm));
  const [shop, setShop] = useState(t.oilShop ?? "");
  const [savingLast, startLast] = useTransition();
  const [savingShop, startShop] = useTransition();
  const [error, setError] = useState<{ field: "last" | "shop"; text: string } | null>(null);

  const last = parseOdo(draft);
  const dirty = last !== t.lastPmKm;
  // A last change above the odometer means the truck has been at least that far: the odometer moves up with it.
  const raised = last != null && last > t.odometerKm;
  const s = serviceStatus({
    odometerKm: raised ? last : t.odometerKm, odometerAt: raised ? now : t.odometerAt, pmIntervalKm: t.pmIntervalKm,
    lastPmKm: last, nextServiceKm: last == null ? null : t.nextServiceKm, truckType: t.truckType,
  }, new Date(now));
  const tone = SERVICE_STATE_TONE[s.state];

  const saveLast = () => {
    if (!dirty) return;
    startLast(async () => {
      setError(null);
      const res = await setLastOilChange(t.id, last).catch(() => ({ error: "Could not save. Try again." }));
      if (res?.error) setError({ field: "last", text: res.error });
    });
  };
  const saveShop = () => {
    if (shop.trim() === (t.oilShop ?? "")) return;
    startShop(async () => {
      setError(null);
      const res = await setOilShop(t.id, shop).catch(() => ({ error: "Could not save. Try again." }));
      if (res?.error) setError({ field: "shop", text: res.error });
    });
  };
  const keys = (revert: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { revert(); setError(null); }
  };

  return (
    <tr className={highlighted ? "bg-accent-soft" : undefined}>
      <td>
        <Link href={truckHref(t.id)} className="num font-medium text-fg hover:underline">{t.unitNumber}</Link>
        <p className="truncate text-[11px] text-fg-subtle">{t.driverName ?? "No driver"}</p>
      </td>
      <td className="whitespace-nowrap">
        <span className="num">{f.dist(raised ? last : t.odometerKm)}</span>
        <p className={cn("text-[11px]", s.stale ? "text-warn" : "text-fg-subtle")}>
          {raised ? "raised to the last change" : s.readingAt ? `as of ${f.day(s.readingAt)}` : "no reading date"}
          {s.stale && editable && !raised && <> · <Link href={readingsHref(t.id)} className="font-medium hover:underline">get reading</Link></>}
        </p>
        {t.gpsDistance > 0 && !raised && (
          <p className="num text-[11px] text-fg-subtle" title="Driven since this reading by ELD GPS (straight line, a little short of the road). Enter a real reading to move the oil countdown.">
            ≈ +{f.dist(t.gpsDistance)} by GPS
          </p>
        )}
      </td>
      <td className="whitespace-nowrap">
        <span className="num">{f.dist(s.interval)}</span>
        <div className="mt-0.5">
          {editable ? <TruckTypeSelect truckId={t.id} value={t.truckTypeId} types={types} /> : <p className="text-[11px] text-fg-subtle">{s.intervalFrom ?? "truck's own"}</p>}
        </div>
      </td>
      <td className="min-w-32 whitespace-nowrap">
        {s.used != null ? <span className="num">{s.stale ? "≥ " : ""}{f.dist(s.used)}</span> : <span className="text-fg-faint">—</span>}
        {s.pct != null && <Progress value={Math.min(1, s.pct)} tone={tone === "neutral" ? "neutral" : tone} className="mt-1.5 w-28" />}
      </td>
      <td className="num whitespace-nowrap text-fg-muted">{s.dueAtKm != null ? f.dist(s.dueAtKm) : <span className="text-fg-faint">—</span>}</td>
      <td className="min-w-40">
        <Badge value={s.state} tone={tone} label={SERVICE_STATE_LABELS[s.state]} />
        <p className={cn("num mt-0.5 text-[11px]", s.state === "overdue" ? "text-danger" : "text-fg-subtle")}>{statusLine(s, f)}</p>
      </td>
      <td className="min-w-48 max-w-64">
        {editable ? (
          <input value={shop} onChange={(e) => setShop(e.target.value)} onBlur={saveShop} onKeyDown={keys(() => setShop(t.oilShop ?? ""))}
            maxLength={200} placeholder="Shop name or address" aria-label={`Oil change shop for ${t.unitNumber}`} disabled={savingShop}
            className={cn(inputClass, "h-7 text-[12px]", error?.field === "shop" && "border-danger")} />
        ) : (
          <p className={cn("truncate text-[12px]", t.oilShop ? "text-fg" : "text-fg-faint")}>{t.oilShop ?? "Not set"}</p>
        )}
        {error?.field === "shop" ? <p role="alert" className="mt-0.5 text-[11px] text-danger">{error.text}</p>
          : savingShop ? <p className="mt-0.5 text-[11px] text-fg-subtle">Saving…</p>
          : t.booked && (
            <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
              <Link href={workOrderHref(t.booked.id)} className="num font-medium text-fg-muted hover:underline">{roLabel(t.booked.number)}</Link>
              {" · "}{t.booked.inShop ? "in the shop" : `booked ${f.day(t.booked.scheduledAt)}`}
              {t.booked.vendor ? <> · <Link href={vendorHref(t.booked.vendor.id)} className="hover:underline">{t.booked.vendor.name}</Link></> : t.booked.vendorName ? ` · ${t.booked.vendorName}` : ""}
            </p>
          )}
      </td>
      <td className="whitespace-nowrap">
        {editable ? (
          <div className="relative w-32">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveLast} onKeyDown={keys(() => setDraft(t.lastPmKm == null ? "" : String(t.lastPmKm)))}
              inputMode="numeric" placeholder="Odometer" aria-label={`Odometer at ${t.unitNumber}'s last oil change (${f.labels.distance})`} disabled={savingLast}
              className={cn(inputClass, "num h-7 pr-8 text-right text-[12px]", error?.field === "last" && "border-danger", dirty && "border-accent")} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-subtle">{f.labels.distance}</span>
          </div>
        ) : (
          last != null ? <span className="num">{f.dist(last)}</span> : <span className="text-fg-faint">—</span>
        )}
        <p className={cn("mt-0.5 text-[11px]", error?.field === "last" ? "text-danger" : "text-fg-subtle")} role={error?.field === "last" ? "alert" : undefined}>
          {error?.field === "last" ? error.text
            : savingLast ? "Saving…"
            : dirty ? "Enter to save · Esc to undo"
            : t.lastPmAt ? f.date(t.lastPmAt) : last != null ? "no date" : editable ? "type the last one" : ""}
        </p>
      </td>
    </tr>
  );
}

/** "4,043 mi over" · "672 mi left" · "≥ 8,092 mi used as of Sep 24" · "No oil change recorded yet". */
function statusLine(s: ServiceStatus, f: Formatter) {
  switch (s.state) {
    case "overdue": return `${f.dist(-(s.left ?? 0))} over${s.stale ? " (at least)" : ""}`;
    case "due_now":
    case "due_soon":
    case "ok": return `${f.dist(s.left)} left`;
    case "no_reading": return s.used != null ? `≥ ${f.dist(s.used)} used${s.readingAt ? ` as of ${f.day(s.readingAt)}` : ""}` : "Get a reading";
    case "unknown": return "No oil change recorded yet";
  }
}
