import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Truck as TruckIcon } from "lucide-react";
import { humanize } from "@/lib/constants";
import { Badge, cn } from "@/components/ui";
import { trailerHref, truckHref } from "../_lib/links";

type Ref = { id: string; unitNumber: string } | null | undefined;

/** Unit number as a link to the truck / trailer, with a quiet type glyph. */
export function UnitLink({ truck, trailer, secondary, className }: { truck?: Ref; trailer?: Ref; secondary?: ReactNode; className?: string }) {
  const unit = truck ?? trailer;
  if (!unit) return <span className="text-fg-faint">—</span>;
  const Icon = truck ? TruckIcon : Container;
  return (
    <div className={cn("min-w-0", className)}>
      <Link href={truck ? truckHref(unit.id) : trailerHref(unit.id)} className="inline-flex items-center gap-1.5 font-medium text-fg hover:underline">
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="num unit-no">{unit.unitNumber}</span>
      </Link>
      {secondary && <div className="truncate pl-5 text-[11px] text-fg-subtle">{secondary}</div>}
    </div>
  );
}

const PRIORITY_QUIET = new Set(["LOW", "MEDIUM", "NORMAL"]);

/** Priority as quiet text for the common levels; a badge only when it needs attention. */
export function Priority({ value }: { value: string }) {
  return PRIORITY_QUIET.has(value) ? <span className="text-[12px] text-fg-muted">{humanize(value)}</span> : <Badge value={value} />;
}
