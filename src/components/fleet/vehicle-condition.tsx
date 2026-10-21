import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { PTI_COMPONENTS, PTI_RATING_LABELS } from "@/lib/constants";
import { STALE_READING_DAYS } from "@/lib/service";
import { RATING_TONE, boardHref, componentLabel, daysBetween, plural } from "@/lib/pti-shared";
import { Card, Chip, InfoTip, cn } from "@/components/ui";

/**
 * Latest rating per walk-around component for one truck, carried forward until a later walk-around rates it again
 * ("Good · rated Oct 5 by Aziza · 16 days old"). Now and Soon stand out; Not seen is shown as such, never as good.
 */
export async function VehicleCondition({ truckId }: { truckId: string }) {
  const [me, f] = await Promise.all([getCurrentUser(), getFormat()]);
  const now = new Date();
  const ratings = await db.walkAroundRating.findMany({
    where: { walkAround: { truckId, reviewedAt: { not: null } } },
    orderBy: { walkAround: { weekStart: "desc" } },
    take: PTI_COMPONENTS.length * 26,
    select: { component: true, rating: true, walkAround: { select: { weekStart: true, reviewedAt: true, reviewedBy: { select: { name: true } } } } },
  });
  const latest = new Map<string, (typeof ratings)[number]>();
  for (const r of ratings) if (!latest.has(r.component)) latest.set(r.component, r);
  const editable = can(me?.role, "fleet.edit");
  const boardLink = editable ? boardHref({ review: truckId }) : boardHref();
  const bad = PTI_COMPONENTS.filter((c) => ["NOW", "SOON"].includes(latest.get(c)?.rating ?? "")).length;
  const unseen = PTI_COMPONENTS.filter((c) => latest.get(c)?.rating === "UNSEEN").length;
  const newest = ratings[0]?.walkAround.reviewedAt ?? null;

  return (
    <Card flush title={
      <span className="flex items-center gap-1.5">
        Vehicle condition
        <InfoTip>From the weekly walk-around videos. Each part keeps its last rating until a later walk-around rates it again, so older ratings show their age.</InfoTip>
      </span>
    } actions={<Link href={boardLink} className="text-[12px] text-fg-muted hover:text-fg">{editable ? "Review this week" : "Pre-trip board"}</Link>}>
      {latest.size === 0 ? (
        <p className="px-4 pb-3 pt-1 text-[13px] text-fg-muted">No walk-around reviewed yet. Ratings appear here once someone reviews this truck&apos;s video on the pre-trip board.</p>
      ) : (
        <>
          <p className="px-4 pb-2 text-[12px] text-fg-subtle">
            {bad ? <span className="font-medium text-warn">{plural(bad, "part")} need work</span> : <span className="text-ok">Nothing flagged</span>}
            {unseen > 0 && <> · {unseen} not seen</>}
            {newest && <> · last review {f.day(newest)}</>}
          </p>
          <ul className="grid border-t border-line sm:grid-cols-2">
            {PTI_COMPONENTS.map((c) => {
              const r = latest.get(c);
              const when = r ? r.walkAround.reviewedAt ?? r.walkAround.weekStart : null;
              const age = when ? daysBetween(when, now) : null;
              const flagged = r?.rating === "NOW" || r?.rating === "SOON";
              return (
                <li key={c} className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:odd:border-r",
                  r?.rating === "NOW" ? "bg-danger-soft/50" : r?.rating === "SOON" ? "bg-warn-soft/50" : undefined)}>
                  <div className="min-w-0">
                    <p className={cn("truncate text-[13px]", flagged ? "font-medium text-fg" : "text-fg")}>{componentLabel(c)}</p>
                    <p className="truncate text-[11px] text-fg-subtle">
                      {r && when ? (
                        <>
                          rated {f.day(when)}{r.walkAround.reviewedBy ? ` by ${r.walkAround.reviewedBy.name.split(" ")[0]}` : ""}
                          {" · "}<span className={cn(age != null && age > STALE_READING_DAYS && "text-warn")}>{age === 0 ? "today" : `${plural(age ?? 0, "day")} old`}</span>
                        </>
                      ) : "Not rated yet"}
                    </p>
                  </div>
                  {r ? <Chip tone={RATING_TONE[r.rating] ?? "neutral"}>{PTI_RATING_LABELS[r.rating] ?? r.rating}</Chip> : <span className="text-[11px] text-fg-faint">—</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
