import type { Formatter } from "@/lib/locale";
import { Badge, Chip, cn } from "@/components/ui";
import { downtime, downtimeTone, driverNotTold, payerLabel, repairStatusLabel, repairStatusTone, repairTypeLabel, stageLabel } from "./shared";

/*
 * Small pieces every repair list draws the same way: status with stage and downtime, the tags, and the due /
 * completed date. Server-renderable (no hooks), so pages and the unit cards can pass the company formatter in.
 */

type RepairLike = {
  status: string; voidedAt: Date | null; stage: string | null; inAt: Date | null; outAt: Date | null;
  repairType: string; payer: string; driverInformedAt: Date | null;
  scheduledAt: Date; promisedAt: Date | null; completedAt: Date | null;
};

/** Status badge, with the stage and the downtime clock underneath while it is in the shop. */
export function RepairStatus({ w, now }: { w: RepairLike; now: number }) {
  const d = downtime(w, now);
  const stage = w.status === "IN_PROGRESS" ? stageLabel(w.stage) : null;
  return (
    <div className="min-w-0">
      <Badge value={w.status} tone={repairStatusTone(w)} label={repairStatusLabel(w)} dot />
      {(stage || (d && w.status === "IN_PROGRESS")) && (
        <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
          {stage}{stage && d ? " · " : ""}{d && <span className={cn("num", downtimeTone(d.ms) === "danger" ? "text-danger" : downtimeTone(d.ms) === "warn" ? "text-warn" : undefined)}>{d.text}</span>}
        </p>
      )}
    </div>
  );
}

/** Repair type, who pays, and what needs a look (driver not told). */
export function RepairTags({ w, showType = true, className }: { w: RepairLike; showType?: boolean; className?: string }) {
  const notTold = driverNotTold(w);
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {showType && <Chip tone={w.repairType === "ACCIDENT" ? "danger" : "neutral"}>{repairTypeLabel(w.repairType)}</Chip>}
      {w.payer === "DRIVER" && <Chip tone="progress">{payerLabel(w.payer)}</Chip>}
      {notTold && <Chip tone="warn">Driver not told</Chip>}
      {w.payer === "WARRANTY" && <Chip tone="info">Warranty claim</Chip>}
      {w.payer === "INVESTIGATION" && <Chip tone="warn">Under investigation</Chip>}
    </span>
  );
}

/** When it is due back (or booked for), or when it was completed. Past the promised date reads as a problem. */
export function RepairDue({ w, f, now, todayStart }: { w: RepairLike; f: Formatter; now: number; todayStart: number }) {
  const DAY = 86_400_000;
  if (w.voidedAt || w.status === "CANCELLED") return <span className="text-fg-faint">—</span>;
  if (w.status === "DONE") return <span className="num whitespace-nowrap text-fg-muted">{f.date(w.completedAt ?? w.outAt)}</span>;
  if (w.status === "IN_PROGRESS") {
    if (!w.promisedAt) return <span className="text-[12px] text-fg-faint">No date promised</span>;
    const late = w.promisedAt.getTime() < now;
    return (
      <div className="whitespace-nowrap">
        <span className={cn("num", late ? "font-medium text-danger" : "text-fg-muted")}>{f.date(w.promisedAt)}</span>
        {late && <p className="num text-[11px] text-danger">{Math.max(1, Math.floor((now - w.promisedAt.getTime()) / DAY))}d past promised</p>}
      </div>
    );
  }
  const missed = w.scheduledAt.getTime() < todayStart;
  return (
    <div className="whitespace-nowrap">
      <span className={cn("num", missed ? "font-medium text-danger" : "text-fg-muted")}>{f.date(w.scheduledAt)}</span>
      <p className={cn("text-[11px]", missed ? "text-danger" : "text-fg-subtle")}>{missed ? "Booked, not in yet" : "Booked"}</p>
    </div>
  );
}
