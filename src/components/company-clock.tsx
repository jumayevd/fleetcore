"use client";

import { useEffect, useState } from "react";
import { makeFormat, zoneCity, type CompanyLocale } from "@/lib/locale";

/**
 * The company's time (and zone) with the viewer's own clock next to it when they differ — a US fleet run from
 * Tashkent reads "9:32 AM EDT · 6:32 PM Tashkent". Rendered after mount, so server and browser never disagree.
 */
export function CompanyClock({ locale }: { locale: CompanyLocale }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 20_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  if (!now) return <span className="hidden w-28 md:block" aria-hidden />;

  const company = makeFormat(locale);
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const differs = mine && mine !== locale.timezone && company.time(now) !== makeFormat({ ...locale, timezone: mine }).time(now);
  const local = differs ? makeFormat({ ...locale, timezone: mine }) : null;
  const label = `${company.time(now)} ${company.zone(now)} in the company${local ? `, ${local.time(now)} in ${zoneCity(mine)}` : ""}`;

  return (
    <span className="hidden flex-col items-end leading-tight md:flex" title={label} aria-label={label}>
      <span className="num text-[13px] font-semibold text-fg">{company.time(now)} <span className="text-[11px] font-medium text-fg-subtle">{company.zone(now)}</span></span>
      {local && <span className="num text-[11px] text-fg-subtle">{local.time(now)} {zoneCity(mine)}</span>}
    </span>
  );
}
