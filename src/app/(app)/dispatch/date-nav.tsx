"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn, inputClass } from "@/components/ui";

const DAY = 86_400_000;
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** prev / today / next + a native date input. Keeps the other board params (view, team) in the URL. */
export function DateNav({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const go = (ymd: string) => {
    const p = new URLSearchParams(sp.toString());
    if (ymd === today) p.delete("date"); else p.set("date", ymd);
    const qs = p.toString();
    start(() => router.push(`/dispatch${qs ? `?${qs}` : ""}`));
  };
  const isToday = date === today;
  return (
    <div className={cn("flex items-center gap-1", pending && "opacity-70")} aria-label="Board date">
      <Button variant="secondary" size="sm" className="w-7 px-0" aria-label="Previous day" onClick={() => go(shift(date, -1))}><ChevronLeft /></Button>
      <Button variant={isToday ? "secondary" : "primary"} size="sm" onClick={() => go(today)} disabled={isToday}>Today</Button>
      <Button variant="secondary" size="sm" className="w-7 px-0" aria-label="Next day" onClick={() => go(shift(date, 1))}><ChevronRight /></Button>
      <label className="relative ml-1">
        <span className="sr-only">Pick a date</span>
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className={cn(inputClass, "num h-7 w-[150px] text-[12px]")} />
      </label>
    </div>
  );
}
