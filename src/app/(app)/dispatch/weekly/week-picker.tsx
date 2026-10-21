"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn, inputClass } from "@/components/ui";
import { shiftYmd, ymdDayMonth, ymdDayMonthYear } from "../dates";

const shift = (ymd: string, weeks: number) => shiftYmd(ymd, weeks * 7);
/** Calendar arithmetic on the YYYY-MM-DD string itself, so the label never depends on the server's or browser's zone. */
const label = (ymd: string) => `${ymdDayMonth(ymd)} – ${ymdDayMonthYear(shiftYmd(ymd, 6))}`;

/** prev / this week / next + a list of recent weeks. */
export function WeekPicker({ week, thisWeek }: { week: string; thisWeek: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (ymd: string) => start(() => router.push(ymd === thisWeek ? "/dispatch/weekly" : `/dispatch/weekly?week=${ymd}`));
  const options = Array.from({ length: 30 }, (_, i) => shift(thisWeek, 3 - i));
  if (!options.includes(week)) options.push(week);
  options.sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className={cn("flex items-center gap-1", pending && "opacity-70")} aria-label="Week">
      <Button variant="secondary" size="sm" className="w-7 px-0" aria-label="Previous week" onClick={() => go(shift(week, -1))}><ChevronLeft /></Button>
      <Button variant={week === thisWeek ? "secondary" : "primary"} size="sm" disabled={week === thisWeek} onClick={() => go(thisWeek)}>This week</Button>
      <Button variant="secondary" size="sm" className="w-7 px-0" aria-label="Next week" onClick={() => go(shift(week, 1))}><ChevronRight /></Button>
      <label className="ml-1">
        <span className="sr-only">Pick a week</span>
        <select value={week} onChange={(e) => go(e.target.value)} className={cn(inputClass, "h-7 w-[210px] text-[12px]")}>
          {options.map((w) => (
            <option key={w} value={w}>{label(w)}{w === thisWeek ? " · this week" : w === shift(thisWeek, -1) ? " · last week" : ""}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
