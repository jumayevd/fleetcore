"use client";

import { useState } from "react";
import { deleteCompany, saveCompanyRegion } from "@/app/actions/company";
import { ActionForm, SubmitButton } from "@/components/forms";
import { CompanyBadge } from "@/components/workspace-switcher";
import { Field, Input, buttonClass, cn, inputClass } from "@/components/ui";
import { COMPANY_COLORS } from "@/lib/constants";
import { COMMON_TIMEZONES, CURRENCIES, UNIT_SYSTEMS, makeFormat, zoneCity, type CompanyLocale, type UnitSystem } from "@/lib/locale";

/** Badge colour swatches with a live preview of the company badge. Posts the hex as `name`. */
export function ColorPicker({ name, value, companyName }: { name: string; value: string | null; companyName: string }) {
  const [color, setColor] = useState<string>(value ?? COMPANY_COLORS[0]);
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={color} />
      <CompanyBadge name={companyName} color={color} size={32} />
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Badge colour">
        {COMPANY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
            className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-shadow", color === c && "ring-2 ring-fg-muted")} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

const SAMPLE_AT = new Date("2026-10-21T13:32:00Z");

/**
 * Units, time zone and currency, with a live example of how numbers and dates will read. Switching units offers to
 * convert what is already stored (on by default), so odometers and intervals keep meaning the same distance.
 */
export function RegionSettings({ locale, zones, counts }: {
  locale: CompanyLocale;
  /** Every IANA zone the server knows, for the "All zones" group. */
  zones: string[];
  counts: { trucks: number; fuelLogs: number };
}) {
  const [units, setUnits] = useState<UnitSystem>(locale.units);
  const [tz, setTz] = useState(locale.timezone);
  const [currency, setCurrency] = useState(locale.currency);
  const [convert, setConvert] = useState(true);
  const switching = units !== locale.units;
  const converting = switching && convert;

  const sample = makeFormat({ units, timezone: tz, currency });
  const odometer = units === "imperial" ? 412_380 : 663_660;
  const fill = units === "imperial" ? 118.4 : 448.2;
  const common = (COMMON_TIMEZONES as readonly string[]).includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES];
  const currencies = (CURRENCIES as readonly string[]).includes(currency) ? CURRENCIES : [currency, ...CURRENCIES];
  const zoneLabel = (z: string) => `${zoneCity(z)} · ${makeFormat({ ...locale, timezone: z }).zone(SAMPLE_AT)}`;

  return (
    <ActionForm action={saveCompanyRegion} className="space-y-3"
      confirm={converting ? `Convert every odometer, interval, fuel volume and weight to ${units === "metric" ? "kilometres, litres and kilograms" : "miles, gallons and pounds"}?` : undefined}>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Units">
        {UNIT_SYSTEMS.map((u) => (
          <label key={u.value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
            units === u.value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
            <input type="radio" name="units" value={u.value} checked={units === u.value} onChange={() => setUnits(u.value)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="block text-[13px] font-medium text-fg">{u.label}</span>
              <span className="block text-[11px] text-fg-subtle">{u.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {switching && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-fg">
            <input type="checkbox" name="convert" checked={convert} onChange={(e) => setConvert(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">Convert the numbers already saved</span>
              <span className="block text-fg-muted">
                {convert
                  ? `Odometers, service intervals, tank sizes, fuel fills and trailer weights are converted (${counts.trucks} trucks, ${counts.fuelLogs} fuel fills). Money is not touched.`
                  : `Numbers stay as they are and are read as ${units === "metric" ? "km, L and kg" : "mi, gal and lb"} — only right if they were entered in those units.`}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label="Time zone" hint="Dates, due times and the week the walk-around board uses.">
          <div className="flex gap-1.5">
            <select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} className={cn(inputClass, "pr-7")}>
              <optgroup label="Common">{common.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}</optgroup>
              <optgroup label="All zones">{zones.filter((z) => !common.includes(z as never)).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</optgroup>
            </select>
            <button type="button" className={buttonClass("secondary", "sm") + " h-8 shrink-0"} title="Use the time zone of this computer"
              onClick={() => { const mine = Intl.DateTimeFormat().resolvedOptions().timeZone; if (mine) setTz(mine); }}>Mine</button>
          </div>
        </Field>
        <Field label="Currency">
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(inputClass, "pr-7")}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <p className="rounded-md bg-sunken px-3 py-2 text-[12px] text-fg-muted">
        <span className="font-medium text-fg">Reads as </span>
        <span className="num" suppressHydrationWarning>
          {sample.dist(odometer)} · {sample.vol(fill)} · {sample.economyText(units === "imperial" ? 6.4 : 36.8)} · {sample.money2(1284.5)} · {sample.dateTime(SAMPLE_AT)} {sample.zone(SAMPLE_AT)}
        </span>
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingText={converting ? "Converting…" : "Saving…"}>{converting ? "Save and convert" : "Save region"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Owners only: delete the company and everything in it, after typing its name. */
export function DeleteCompany({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-danger/30 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-fg">Delete this company</h2>
          <p className="text-[12px] text-fg-muted">Removes {name} with all its trucks, trailers, drivers, work orders and documents, for every member. This can&apos;t be undone.</p>
        </div>
        {!open && <button type="button" onClick={() => setOpen(true)} className="h-8 rounded-md border border-danger/40 px-3 text-[12px] font-medium text-danger hover:bg-danger-soft">Delete company…</button>}
      </div>
      {open && (
        <ActionForm action={deleteCompany} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={`Type ${name} to confirm`} className="min-w-64 flex-1"><Input name="confirm" required autoComplete="off" /></Field>
          <SubmitButton variant="danger" pendingText="Deleting…">Delete forever</SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-[12px] font-medium text-fg-muted hover:bg-raised">Cancel</button>
        </ActionForm>
      )}
    </section>
  );
}
