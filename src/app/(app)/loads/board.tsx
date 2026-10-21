import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BILLING_STAGE_LABELS, LOAD_STATUS_LABELS, humanize, type BillingStage, type LoadStatus } from "@/lib/constants";
import { ago, dateTime, money, number } from "@/lib/format";
import { estimatedArrival, loadProgress } from "@/lib/telemetry";
import { Badge, Chip, LinkButton, Progress, STATUS_TONE, cn } from "@/components/ui";
import { PRIORITY_TONE, lateness } from "./shared";
import type { ListLoad } from "./query";

export type BoardColumn = {
  status: LoadStatus;
  /** The first cards of the column (capped server-side). */
  loads: ListLoad[];
  /** Every load in the column, for the count and the "+n more" link. */
  total: number;
  /** The table filtered to this status. */
  moreHref: string;
};

/** Kanban: Booked → Dispatched → In transit → Delivered (last 7 days). Cards open the load; long columns link to the table. */
export function LoadBoard({ columns, showMoney, canEdit }: { columns: BoardColumn[]; showMoney: boolean; canEdit: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {columns.map(({ status: col, loads: items, total, moreHref }) => {
        const more = total - items.length;
        return (
          <section key={col} aria-label={LOAD_STATUS_LABELS[col]} className="flex min-h-40 flex-col rounded-lg border border-line bg-sunken/60">
            <header className="flex items-center justify-between gap-2 px-3 py-2">
              <Badge value={col} label={LOAD_STATUS_LABELS[col]} dot />
              <span className="num text-[11px] text-fg-subtle">{number(total)}{col === "DELIVERED" && " · last 7 days"}</span>
            </header>
            <div className="flex-1 space-y-1.5 px-1.5 pb-1.5">
              {items.map((l) => <BoardCard key={l.id} load={l} column={col} showMoney={showMoney} />)}
              {more > 0 && (
                <Link href={moreHref} className="block rounded-md border border-dashed border-line-strong px-2.5 py-2 text-center text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg">
                  <span className="num">+{number(more)}</span> more · open in table
                </Link>
              )}
              {total === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-[12px] text-fg-subtle">{EMPTY[col]}</p>
                  {col === "PLANNED" && canEdit && <LinkButton href="/loads/new" variant="secondary" size="sm">Book a load</LinkButton>}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const EMPTY: Record<string, string> = {
  PLANNED: "Nothing waiting for a truck.",
  ASSIGNED: "No dispatched loads waiting for pickup.",
  IN_TRANSIT: "Nothing on the road right now.",
  DELIVERED: "No deliveries in the last 7 days.",
};

function BoardCard({ load: l, column, showMoney }: { load: ListLoad; column: LoadStatus; showMoney: boolean }) {
  const eta = column === "IN_TRANSIT" ? estimatedArrival(l) : null;
  const late = lateness(l, eta);
  const stops = l._count.stops;
  return (
    <Link href={`/loads/${l.id}`} className="block rounded-md border border-line bg-surface p-2.5 transition-colors hover:border-line-strong hover:bg-raised">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="num text-[13px] font-medium text-fg">{l.reference}</span>
          {l.priority !== "NORMAL" && <Chip tone={PRIORITY_TONE[l.priority]}>{humanize(l.priority)}</Chip>}
          {l.hazmat && <Chip tone="danger">Hazmat</Chip>}
        </span>
        {showMoney && <span className="num shrink-0 text-[12px] text-fg-muted">{money(l.rate)}</span>}
      </div>
      <p className="mt-1 flex items-center gap-1 truncate text-[13px] text-fg">
        {l.originCity}<ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />{l.destCity}
        {stops > 2 && <span className="num text-[11px] text-fg-subtle">· {stops} stops</span>}
      </p>
      <p className="truncate text-[11px] text-fg-subtle">{l.customer.name}{l.broker && <> · via {l.broker.name}</>} · {l.commodity}</p>

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("num truncate", late ? "text-danger" : "text-fg-muted")}>
          {column === "DELIVERED" ? <>Delivered {dateTime(l.deliveredAt)}{late && " · late"}</>
            : column === "IN_TRANSIT" ? <>ETA {dateTime(eta)}{late ? " · late" : ""} · due {dateTime(l.deliveryAt)}</>
            : <>Pickup {dateTime(l.pickupAt)} · {ago(l.pickupAt)}</>}
        </span>
        <span className={cn("truncate text-right", l.truck ? "text-fg-muted" : "font-medium text-warn")}>
          {l.truck ? <><span className="num">{l.truck.unitNumber}</span>{l.driver && ` · ${l.driver.name.split(" ")[0]}`}</> : "Needs truck"}
        </span>
      </div>
      {column === "IN_TRANSIT" && <Progress value={loadProgress(l)} tone={late ? "danger" : "progress"} className="mt-2" />}
      {column === "DELIVERED" && l.billingStage !== "NONE" && (
        <div className="mt-2"><Chip tone={STATUS_TONE[l.billingStage] ?? "neutral"}>{BILLING_STAGE_LABELS[l.billingStage as BillingStage]}</Chip></div>
      )}
    </Link>
  );
}
