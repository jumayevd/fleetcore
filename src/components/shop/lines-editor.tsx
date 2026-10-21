"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { REPAIR_SYSTEMS, REPAIR_SYSTEM_LABELS } from "@/lib/constants";
import { IconButton, cn, inputClass } from "@/components/ui";
import { useFormat } from "@/components/locale";
import type { LineValue } from "./shared";

type Row = { key: number; system: string; work: string; amount: string };

/**
 * "What was done": one row per job (system, work performed, amount). Submits repeated lineSystem / lineWork /
 * lineAmount fields (read by readLines in src/lib/work-orders.ts). Amounts only for people who can see money.
 */
export function LinesEditor({ initial = [], money, defaultSystem = "OTHER", onTotal, placeholder = "e.g. Replaced front brake pads and rotors", minRows = 1, addLabel = "Add line" }: {
  initial?: LineValue[];
  money: boolean;
  defaultSystem?: string;
  /** Called with the sum of the amounts whenever it changes (to prefill an invoice total). */
  onTotal?: (total: number) => void;
  placeholder?: string;
  /** Rows shown from the start (0: the list starts empty with just the add button). */
  minRows?: number;
  /** The add button's label while there are no rows. */
  addLabel?: string;
}) {
  const f = useFormat();
  const next = useRef(initial.length + minRows + 1);
  const [rows, setRows] = useState<Row[]>(() => {
    const r = initial.map((l, i) => ({ key: i, system: l.system, work: l.work, amount: money && l.amount ? String(l.amount) : "" }));
    while (r.length < minRows) r.push({ key: r.length, system: defaultSystem, work: "", amount: "" });
    return r;
  });
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const onTotalRef = useRef(onTotal);
  useEffect(() => { onTotalRef.current = onTotal; });
  useEffect(() => { onTotalRef.current?.(Math.round(total * 100) / 100); }, [total]);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { key: next.current++, system: rs[rs.length - 1]?.system ?? defaultSystem, work: "", amount: "" }]);
  const remove = (key: number) => setRows((rs) => (rs.length > Math.max(1, minRows) || minRows === 0 ? rs.filter((r) => r.key !== key) : rs.map((r) => ({ ...r, work: "", amount: "" }))));

  return (
    <div>
      {rows.length > 0 && (
        <div className={cn("hidden gap-2 pb-1 text-[11px] font-medium text-fg-subtle sm:grid", money ? "sm:grid-cols-[10rem_1fr_7rem_1.75rem]" : "sm:grid-cols-[10rem_1fr_1.75rem]")}>
          <span>System</span><span>Work performed</span>{money && <span className="text-right">Amount</span>}<span />
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className={cn("grid grid-cols-[1fr_1.75rem] gap-2", money ? "sm:grid-cols-[10rem_1fr_7rem_1.75rem]" : "sm:grid-cols-[10rem_1fr_1.75rem]")}>
            <select name="lineSystem" value={r.system} onChange={(e) => set(r.key, { system: e.target.value })} aria-label={`System, line ${i + 1}`} className={cn(inputClass, "col-span-2 sm:col-span-1")}>
              {REPAIR_SYSTEMS.map((s) => <option key={s} value={s}>{REPAIR_SYSTEM_LABELS[s]}</option>)}
            </select>
            <input name="lineWork" value={r.work} onChange={(e) => set(r.key, { work: e.target.value })} placeholder={i === 0 ? placeholder : "Work performed"}
              aria-label={`Work performed, line ${i + 1}`} maxLength={300} className={cn(inputClass, money ? "col-span-1" : "col-span-1")} />
            {money && (
              <input name="lineAmount" type="number" inputMode="decimal" min={0} step="0.01" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })}
                placeholder="0.00" aria-label={`Amount, line ${i + 1}`} className={cn(inputClass, "num col-start-1 text-right sm:col-start-auto")} />
            )}
            {!money && <input type="hidden" name="lineAmount" value="" />}
            <IconButton label={`Remove line ${i + 1}`} onClick={() => remove(r.key)} className={cn("mt-0.5", money ? "row-start-2 col-start-2 sm:row-start-auto sm:col-start-auto" : "")}><Trash2 /></IconButton>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3">
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">
          <Plus className="h-3.5 w-3.5" />{rows.length ? "Add line" : addLabel}
        </button>
        {money && rows.length > 0 && <span className="text-[12px] text-fg-muted">Lines total <span className="num ml-1 font-semibold text-fg">{f.money2(total)}</span></span>}
      </div>
    </div>
  );
}
