import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { roLabel, serviceStatus, SERVICE_STATE_LABELS, SERVICE_STATE_TONE, STALE_READING_DAYS } from "@/lib/service";
import { Badge, Card, InfoTip, LinkButton, Progress, cn } from "@/components/ui";
import { OIL_SERVICE_TYPES } from "@/components/shop/shared";

const DAY = 86_400_000;
/** Book the annual inspection this many days ahead. */
const INSPECTION_SOON_DAYS = 30;

/**
 * Oil change / PM and annual DOT inspection of one truck (truck page, Maintenance tab), by the same rule as the Oil changes
 * board: what is left, from which reading, the booked shop, and the next step (log, book, get a reading).
 */
export async function ServiceSchedule({ truckId, editable }: { truckId: string; editable: boolean }) {
  const f = await getFormat();
  const now = new Date();
  const [truck, booked, lastOil, dotOpen] = await Promise.all([
    db.truck.findUnique({ where: { id: truckId }, include: { truckType: true } }),
    db.workOrder.findFirst({
      where: { truckId, voidedAt: null, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, OR: [{ repairType: { in: [...OIL_SERVICE_TYPES] } }, { repairType: "REPAIR", category: "PM" }] },
      orderBy: { scheduledAt: "asc" }, select: { id: true, number: true, status: true, scheduledAt: true, vendor: true, vendorRef: { select: { name: true } } },
    }),
    db.workOrder.findFirst({
      where: { truckId, status: "DONE", voidedAt: null, OR: [{ repairType: "OIL_CHANGE" }, { repairType: "REPAIR", category: "PM" }] },
      orderBy: { completedAt: "desc" }, select: { id: true, number: true, vendor: true, vendorRef: { select: { name: true } } },
    }),
    db.workOrder.findFirst({
      where: { truckId, voidedAt: null, status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] }, repairType: "DOT_INSPECTION" },
      select: { id: true, number: true, scheduledAt: true },
    }),
  ]);
  if (!truck) return null;
  const s = serviceStatus(truck, now);
  const tone = SERVICE_STATE_TONE[s.state];
  const big = s.left == null ? "—" : s.state === "no_reading" ? "No recent reading" : s.left < 0 ? `${f.dist(-s.left)} over` : `${f.dist(s.left)} left`;
  const inspDays = truck.inspectionExpiry ? Math.ceil((truck.inspectionExpiry.getTime() - now.getTime()) / DAY) : null;
  const inspTone = inspDays == null ? "neutral" : inspDays < 0 ? "danger" : inspDays <= INSPECTION_SOON_DAYS ? "warn" : "ok";

  return (
    <Card id="service" className="scroll-mt-20" icon={<CalendarClock />}
      title={<span className="flex items-center gap-1.5">Service schedule<InfoTip>Due at = last oil change + the interval ({s.intervalFrom ? `from the ${s.intervalFrom} type` : "the truck's own"}). A reading older than {STALE_READING_DAYS} days makes the figures a lower bound.</InfoTip></span>}
      actions={editable && <LinkButton href={`/maintenance/oil?log=1&truck=${truck.id}`} variant="secondary" size="sm">Log oil change</LinkButton>}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-fg-muted">Oil change</p>
          <p className={cn("num mt-0.5 text-[20px] font-semibold leading-7", s.state === "overdue" ? "text-danger" : s.state === "due_now" ? "text-warn" : "text-fg")}>{big}</p>
        </div>
        <Badge value={s.state} tone={tone} label={SERVICE_STATE_LABELS[s.state]} />
      </div>
      {s.pct != null && <Progress value={Math.min(1, s.pct)} tone={tone === "neutral" ? "neutral" : tone} className="mt-2" />}
      {s.state === "no_reading" && s.used != null && (
        <p className="mt-1.5 text-[12px] text-fg-muted">At least {f.dist(s.used)} used{s.readingAt ? ` as of ${f.date(s.readingAt)}` : ""}.</p>
      )}
      {s.state === "unknown" && (
        <p className="mt-1.5 text-[12px] text-fg-muted">No oil change recorded.{editable && <> <Link href={`/maintenance/oil?log=1&truck=${truck.id}`} className="font-medium text-fg hover:underline">Log the last one</Link> to start the countdown.</>}</p>
      )}

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Last change</dt>
          <dd className="text-right text-fg">
            {s.lastKm != null ? <span className="num">{f.dist(s.lastKm)}</span> : "—"}
            {truck.lastPmAt && <span className="text-fg-subtle"> · {f.date(truck.lastPmAt)}</span>}
            {lastOil && <> · <Link href={`/maintenance/work-orders/${lastOil.id}`} className="num hover:underline">{roLabel(lastOil.number)}</Link></>}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Interval</dt>
          <dd className="text-right text-fg">
            <span className="num">{f.dist(s.interval)}</span>
            <span className="text-fg-subtle"> · {s.intervalFrom ?? "truck's own"}</span>
            {editable && <> · <Link href="/maintenance/oil" className="font-medium text-fg-muted hover:text-fg">Change</Link></>}
          </dd>
        </div>
        <div className="flex justify-between gap-2"><dt className="text-fg-subtle">Due at</dt><dd className="num text-fg">{s.dueAtKm != null ? f.dist(s.dueAtKm) : "—"}</dd></div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-subtle">Odometer</dt>
          <dd className="text-right">
            <span className="num text-fg">{f.dist(truck.odometerKm)}</span>
            <span className={cn(s.stale ? "text-warn" : "text-fg-subtle")}> · {s.readingAt ? `as of ${f.day(s.readingAt)}` : "no reading date"}</span>
            {s.stale && editable && <> · <Link href={`/fleet/${truck.id}?tab=tracking#readings`} className="font-medium text-fg hover:underline">Get reading</Link></>}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-line pt-3 text-[12px]">
        {booked ? (
          <p className="text-fg-muted">
            {booked.status === "IN_PROGRESS" ? "In the shop: " : "Booked: "}
            <Link href={`/maintenance/work-orders/${booked.id}`} className="num font-medium text-fg hover:underline">{roLabel(booked.number)}</Link>
            {booked.status !== "IN_PROGRESS" && <> for {f.date(booked.scheduledAt)}</>}
            {booked.vendorRef ? ` at ${booked.vendorRef.name}` : booked.vendor ? ` at ${booked.vendor}` : ""}
          </p>
        ) : editable && s.state !== "ok" ? (
          <Link href={`/maintenance/oil?book=${truck.id}`} className="font-medium text-fg hover:underline">Book an oil change</Link>
        ) : (
          <p className="text-fg-subtle">No oil change booked.{editable && <> <Link href={`/maintenance/oil?book=${truck.id}`} className="font-medium text-fg-muted hover:text-fg">Book one</Link></>}</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="min-w-0">
          <p className="text-[12px] text-fg-muted">Annual DOT inspection</p>
          <p className="text-[13px] text-fg">
            {truck.inspectionExpiry ? <>Expires <span className="num">{f.date(truck.inspectionExpiry)}</span></> : "No expiry recorded"}
          </p>
          {dotOpen && <Link href={`/maintenance/work-orders/${dotOpen.id}`} className="text-[11px] text-fg-muted hover:underline">Booked: <span className="num">{roLabel(dotOpen.number)}</span> · {f.date(dotOpen.scheduledAt)}</Link>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {inspDays != null && <Badge value="INSPECTION" tone={inspTone} label={inspDays < 0 ? `Expired ${-inspDays}d ago` : `${inspDays}d left`} className="num" />}
          {editable && !dotOpen && (inspDays == null || inspDays <= INSPECTION_SOON_DAYS) && (
            <Link href={`/maintenance/work-orders/new?truck=${truck.id}&type=DOT_INSPECTION`} className="text-[12px] font-medium text-fg-muted hover:text-fg">Book inspection</Link>
          )}
        </div>
      </div>
    </Card>
  );
}
