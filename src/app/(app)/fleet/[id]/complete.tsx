import Link from "next/link";
import { CircleDashed } from "lucide-react";
import { completeTruck } from "@/app/actions/fleet";
import { completeTrailer } from "@/app/(app)/fleet/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Input, LinkButton, Select, cn } from "@/components/ui";
import type { Formatter } from "@/lib/locale";

/*
 * "Finish this unit's record": what is missing from a truck or trailer that the rest of the app relies on, each with a
 * one-click fix right there (an inline field, or a link straight to the place that fixes it).
 */

export type Prompt = { key: string; text: string; hint?: string; fix?: React.ReactNode };

export function CompletenessCard({ prompts, unitLabel }: { prompts: Prompt[]; unitLabel: string }) {
  if (!prompts.length) return null;
  return (
    <Card title={`Finish ${unitLabel}'s record`} icon={<CircleDashed />} flush
      actions={<span className="num text-[11px] text-fg-subtle">{prompts.length} to do</span>}>
      <ul className="divide-y divide-line">
        {prompts.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{p.text}</p>
              {p.hint && <p className="text-[11px] text-fg-subtle">{p.hint}</p>}
            </div>
            {p.fix && <div className="shrink-0">{p.fix}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const inline = "flex items-center gap-2";

/** Inline one-field fix for a truck: plate, in-service date or truck type. */
export function TruckFix({ truckId, field, types, f }: {
  truckId: string;
  field: "plate" | "inServiceAt" | "truckTypeId";
  types?: { id: string; name: string; oilIntervalKm: number }[];
  f: Formatter;
}) {
  const action = completeTruck.bind(null, truckId, field);
  return (
    <ActionForm action={action} className="max-w-sm">
      <div className={inline}>
        {field === "plate" && <Input name="value" required aria-label="Plate" placeholder="Plate number" className={cn("num h-7 w-36 text-[12px]")} />}
        {field === "inServiceAt" && <Input name="value" type="date" required aria-label="In-service date" max={f.dateInput(new Date())} className="h-7 w-40 text-[12px]" />}
        {field === "truckTypeId" && (
          <Select name="value" required aria-label="Truck type" placeholder="Pick a type…" className="h-7 w-52 text-[12px]"
            options={(types ?? []).map((t) => ({ value: t.id, label: `${t.name} · every ${f.dist(t.oilIntervalKm)}` }))} />
        )}
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Inline one-field fix for a trailer: plate or annual inspection date. */
export function TrailerFix({ trailerId, field }: { trailerId: string; field: "plate" | "inspectionExpiry" }) {
  const action = completeTrailer.bind(null, trailerId, field);
  return (
    <ActionForm action={action} className="max-w-sm">
      <div className={inline}>
        {field === "plate"
          ? <Input name="value" required aria-label="Plate" placeholder="Plate number" className="num h-7 w-36 text-[12px]" />
          : <Input name="value" type="date" required aria-label="Annual inspection due" className="h-7 w-40 text-[12px]" />}
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A fix that is a place to go (attach a file, update readings). */
export function FixLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <LinkButton href={href} size="sm" variant="secondary">{children}</LinkButton>;
}

/** Quiet text link used when the viewer can't fix it themselves. */
export function FixNote({ children, href }: { children: React.ReactNode; href?: string }) {
  return href ? <Link href={href} className="text-[12px] text-fg-subtle hover:text-fg hover:underline">{children}</Link> : <span className="text-[12px] text-fg-subtle">{children}</span>;
}
