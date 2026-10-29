import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getFormat } from "@/lib/format-server";
import { dateOnly, type Formatter } from "@/lib/locale";
import { defectLabel, roLabel } from "@/lib/service";
import { loadBoard, loadReview, needsSomething, resolveWeek, type BoardRow, type Week } from "@/lib/pti";
import {
  BOARD_FILTERS, BOARD_STATE_TONE, SEVERITY_SHORT, SEVERITY_TONE, boardHref, chaseMessage, componentLabel, defectsHref, one, plural,
  type BoardFilter,
} from "@/lib/pti-shared";
import { Badge, Card, Chip, Disclosure, EmptyState, IconButton, InfoTip, LinkButton, PageHeader, Stat, Table, buttonClass, cn } from "@/components/ui";
import { ChaseButton, ConfirmClearButton } from "@/components/inspections/board-actions";
import { UrlDrawer } from "@/components/inspections/overlay";
import { ReviewForm, type ReviewFormProps } from "@/components/inspections/review-form";

export const metadata = { title: "Pre-trip board" };

const WO_STATUS: Record<string, string> = { DRAFT: "draft", OPEN: "booked", IN_PROGRESS: "in the shop", DONE: "done", CANCELLED: "cancelled" };
const MAX_ISSUES = 3;

function stateLabel(r: BoardRow) {
  const unseen = r.marks.unseen ? ` · ${r.marks.unseen} not seen` : "";
  switch (r.state) {
    case "out_of_service": return "Out of service";
    case "review": return r.walk?.reviewedAt ? `To review${unseen}` : "To review";
    case "issues": return r.cats.issues
      ? `${plural(r.marks.soon + r.marks.now, "issue")}${unseen}`
      : plural(r.defects.filter((d) => d.status === "OPEN").length, "issue");
    case "repaired": return "Repaired · to confirm";
    case "missing": return r.walk?.video === "MISSING" ? "Missing" : r.walk?.video === "RECEIVED" ? "Nothing seen" : "Nothing sent";
    case "partial": return `Reviewed · ${r.walk?.unseen ?? 0} not seen`;
    case "clean": return "Clean";
    case "not_expected": return r.truck.status === "MAINTENANCE" ? "In the shop" : r.truck.status === "VENDOR" ? "At a vendor" : r.driver ? "Not expected" : "No driver";
  }
}

function videoLine(r: BoardRow, f: Formatter) {
  const w = r.walk;
  if (w?.video === "RECEIVED" && w.reviewedAt && r.marks.total && r.marks.unseen === r.marks.total) return `Nothing could be seen · reviewed ${f.day(w.reviewedAt)}`;
  if (w?.reviewedAt && w.video === "RECEIVED") return `Reviewed ${f.day(w.reviewedAt)}${w.reviewedBy ? ` by ${w.reviewedBy.split(" ")[0]}` : ""}`;
  if (w?.video === "RECEIVED") return `Video in ${w.receivedAt ? f.dateTime(w.receivedAt) : ""}`.trim();
  if (w?.video === "MISSING") return "Marked missing";
  if (r.expected) return "No video yet";
  if (r.truck.status === "MAINTENANCE") return "In the shop, no video expected";
  if (r.truck.status === "VENDOR") return "At a vendor, no video expected";
  return "No video expected";
}

function RowAction({ r, week, show, f, sender }: { r: BoardRow; week: Week; show: BoardFilter; f: Formatter; sender: string }) {
  const reviewHref = boardHref({ week: week.isCurrent ? undefined : week.key, show, review: r.truck.id });
  if (r.action === "review") return <LinkButton href={reviewHref} size="sm" scroll={false}><ClipboardCheck />Review</LinkButton>;
  if (r.action === "confirm") {
    const repaired = r.defects.filter((d) => d.status === "REPAIRED");
    return <ConfirmClearButton truckId={r.truck.id} unitNumber={r.truck.unitNumber} holds={repaired.some((d) => d.holdsUnit)}
      defects={repaired.map((d) => ({ id: d.id, number: d.number, component: d.component, description: d.description }))} />;
  }
  if (r.action === "chase") {
    return (
      <span className="inline-flex items-center gap-1">
        <ChaseButton driver={r.driver?.name} phone={r.driver?.phone}
          message={chaseMessage({ driver: r.driver?.name, unit: r.truck.unitNumber, weekOf: f.day(week.at), due: f.weekday(week.end), sender })} />
        <Link href={reviewHref} scroll={false} className={buttonClass("ghost", "sm")} title="Record the video as received or missing">Record</Link>
      </span>
    );
  }
  return <Link href={reviewHref} scroll={false} className={buttonClass("ghost", "sm")}>{r.walk?.reviewedAt ? "Open review" : "Review"}</Link>;
}

function Issues({ r }: { r: BoardRow }) {
  if (!r.defects.length) return <span className="text-fg-faint">—</span>;
  const shown = r.defects.slice(0, MAX_ISSUES);
  return (
    <ul className="max-w-[28rem] space-y-1">
      {shown.map((d) => (
        <li key={d.id} className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
          <Chip tone={SEVERITY_TONE[d.severity] ?? "neutral"} className="shrink-0">{SEVERITY_SHORT[d.severity] ?? d.severity}</Chip>
          <span className="min-w-0 truncate" title={`${defectLabel(d.number)} · ${componentLabel(d.component)} — ${d.description}`}>
            <Link href={defectsHref({ defect: d.id })} className="font-medium text-fg hover:underline">{componentLabel(d.component)}</Link>
            <span className="text-fg-muted"> — {d.description}</span>
          </span>
          <span className={cn("num shrink-0 text-[11px]", d.overdue ? "text-danger" : "text-fg-subtle")}>
            {d.status === "REPAIRED" ? <span className="text-info">repaired · not yet confirmed</span> : `${d.daysOpen}d open${d.overdue ? " · overdue" : ""}`}
          </span>
          {d.workOrder && d.status === "OPEN" && (
            <Link href={`/maintenance/work-orders/${d.workOrder.id}`} className="num shrink-0 text-[11px] text-fg-subtle hover:underline">{roLabel(d.workOrder.number)} {WO_STATUS[d.workOrder.status] ?? ""}</Link>
          )}
        </li>
      ))}
      {r.defects.length > MAX_ISSUES && (
        <li><Link href={defectsHref({ unit: r.truck.id })} className="text-[11px] text-fg-subtle hover:underline">+{r.defects.length - MAX_ISSUES} more</Link></li>
      )}
    </ul>
  );
}

function BoardTable({ rows, week, show, f, editable, sender }: { rows: BoardRow[]; week: Week; show: BoardFilter; f: Formatter; editable: boolean; sender: string }) {
  return (
    <Table stickyHead={false} head={["Unit", "Status", "Last inspection", "Open issues", ""]}>
      {rows.map((r) => {
        const line = videoLine(r, f);
        return (
          <tr key={r.truck.id} className="align-top">
            <td className="whitespace-nowrap">
              <Link href={`/fleet/${r.truck.id}`} className="num unit-no font-medium text-fg hover:underline">{r.truck.unitNumber}</Link>
              <div className="max-w-56 truncate text-[11px] text-fg-subtle" title={r.driver ? `${r.driver.name}${r.driver.dispatcher ? ` · dispatcher ${r.driver.dispatcher}` : ""}` : undefined}>
                {r.driver ? <>{r.driver.name}{r.driver.dispatcher && <span className="text-fg-faint"> · {r.driver.dispatcher}</span>}</> : "No driver"}
              </div>
            </td>
            <td className="whitespace-nowrap">
              <Badge value={r.state} label={stateLabel(r)} tone={BOARD_STATE_TONE[r.state]} dot />
              {line && <div className="mt-0.5 text-[11px] text-fg-subtle">{line}</div>}
            </td>
            <td className="whitespace-nowrap">
              {r.last ? (
                <div title={`Week of ${f.day(r.last.weekStart)}`}>
                  <span className="num text-fg">{f.day(r.last.reviewedAt)}</span>
                  <div className="text-[11px] text-fg-subtle">{r.last.reviewedBy ?? "—"}{r.last.result === "ISSUES" ? " · issues" : r.last.result === "CLEAN" ? " · clean" : ""}</div>
                </div>
              ) : <span className="text-fg-faint">Never reviewed</span>}
            </td>
            <td><Issues r={r} /></td>
            <td className="whitespace-nowrap text-right">{editable && <RowAction r={r} week={week} show={show} f={f} sender={sender} />}</td>
          </tr>
        );
      })}
    </Table>
  );
}

function Counter({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined}
      className={cn("block rounded-lg transition-shadow hover:shadow-lift focus-visible:outline-2", active && "ring-2 ring-accent/50")}>
      {children}
    </Link>
  );
}

/** "Review of 005 saved…" after the drawer closes (computed from what is stored, so a reload says the same). */
async function SavedNotice({ truckId, week, closeHref }: { truckId: string; week: Week; closeHref: string }) {
  const [truck, walk, holding] = await Promise.all([
    db.truck.findUnique({ where: { id: truckId }, select: { unitNumber: true } }),
    db.walkAround.findUnique({
      where: { truckId_weekStart: { truckId, weekStart: dateOnly(week.key) } },
      select: { video: true, result: true, reviewedAt: true, defects: { where: { status: { not: "CLOSED" } }, select: { number: true } } },
    }),
    db.defect.count({ where: { truckId, holdsUnit: true, status: { not: "CLOSED" } } }),
  ]);
  if (!truck || !walk) return null;
  const u = truck.unitNumber;
  const text = walk.video === "MISSING"
    ? `Marked ${u}'s video as missing. Chase the driver, then review it when it arrives.`
    : `Review of ${u} saved: ${walk.result === "CLEAN" ? "clean" : walk.defects.length ? `new ${walk.defects.map((d) => defectLabel(d.number)).join(", ")}` : "issues noted on earlier defects"}.${holding ? ` ${u} is out of service until someone confirms the repair.` : ""}`;
  return (
    <div role="status" className={cn("mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]", holding ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
      {holding ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="flex-1">{text}</span>
      <Link href={closeHref} scroll={false} aria-label="Dismiss" className="text-current opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></Link>
    </div>
  );
}

export default async function PreTripBoard({ searchParams }: PageProps<"/inspections">) {
  const me = await requireUser("fleet.view");
  const editable = can(me.role, "fleet.edit");
  const f = await getFormat();
  const sp = await searchParams;
  const now = new Date();
  const week = resolveWeek(f, one(sp.week), now);
  const showParam = one(sp.show);
  const show: BoardFilter = (BOARD_FILTERS as readonly string[]).includes(showParam ?? "") ? (showParam as BoardFilter) : "needs";
  const weekParam = week.isCurrent ? undefined : week.key;
  const { rows, counts } = await loadBoard(week, now);

  // Each counter lists exactly the trucks it counts (a truck can be in two: not seen + soon/now).
  const filtered: Record<BoardFilter, BoardRow[]> = {
    needs: rows.filter(needsSomething),
    missing: rows.filter((r) => r.cats.nothingSent),
    review: rows.filter((r) => r.cats.review),
    issues: rows.filter((r) => r.cats.issues),
    clean: rows.filter((r) => r.cats.clean),
    all: rows.filter((r) => r.cats.sent),
  };
  const main = filtered[show];
  const rest = show === "needs" ? rows.filter((r) => !needsSomething(r)) : [];
  const href = (s: BoardFilter) => boardHref({ week: weekParam, show: show === s ? undefined : s });
  const closeHref = boardHref({ week: weekParam, show });

  // The review drawer (?review=<truckId>), for people who can record reviews.
  const reviewId = one(sp.review);
  let review: (ReviewFormProps & { title: string; subtitle: string }) | null = null;
  if (reviewId && editable) {
    const data = await loadReview(reviewId, week, f, now);
    if (data) {
      const queue = main.filter((r) => r.action === "review" && r.truck.id !== reviewId);
      const at = main.findIndex((r) => r.truck.id === reviewId);
      const next = queue.find((r) => main.indexOf(r) > at) ?? queue[0] ?? null;
      const w = data.walk;
      review = {
        title: `Review ${data.truck.unitNumber}`,
        subtitle: [`Week of ${f.day(week.at)}`, data.truck.driver?.name ?? "No driver", data.truck.driver?.dispatcher ? `dispatcher ${data.truck.driver.dispatcher}` : null].filter(Boolean).join(" · "),
        truckId: data.truck.id, unitNumber: data.truck.unitNumber,
        week: week.key, weekLabel: f.day(week.at), show: show === "needs" ? undefined : show,
        video: w?.video ?? "AWAITING",
        receivedLabel: w?.receivedAt ? f.dateTime(w.receivedAt) : null,
        reviewed: w?.reviewedAt ? { by: w.reviewedBy?.name ?? null, on: f.dateTime(w.reviewedAt), stamp: w.reviewedAt.toISOString() } : null,
        notes: w?.notes ?? "",
        ratings: Object.fromEntries((w?.ratings ?? []).map((r) => [r.component, r.rating])),
        thisWeek: Object.fromEntries((w?.defects ?? []).map((d) => [d.component, { number: d.number, description: d.description, severity: d.severity }])),
        earlier: data.earlier.map((d) => ({
          id: d.id, number: d.number, component: d.component, description: d.description, severity: d.severity, status: d.status,
          holdsUnit: d.holdsUnit, daysOpen: d.daysOpen, repair: d.workOrder ? `${roLabel(d.workOrder.number)} ${WO_STATUS[d.workOrder.status] ?? ""}`.trim() : null,
        })),
        history: data.history.map((h) => ({
          key: h.key, label: f.day(h.at), current: h.key === week.key,
          video: h.walk?.video ?? null, result: h.walk?.reviewedAt ? h.walk.result : null,
          reviewer: h.walk?.reviewedBy?.name ?? null, reviewedOn: h.walk?.reviewedAt ? f.day(h.walk.reviewedAt) : null,
          soon: h.walk?.ratings.filter((x) => x.rating === "SOON").length ?? 0,
          now: h.walk?.ratings.filter((x) => x.rating === "NOW").length ?? 0,
          unseen: h.walk?.ratings.filter((x) => x.rating === "UNSEEN").length ?? 0,
          total: h.walk?._count.ratings ?? 0,
          found: h.walk?._count.defects ?? 0,
        })),
        next: next ? { truckId: next.truck.id, unitNumber: next.truck.unitNumber } : null,
        closeHref,
      };
    }
  }
  const savedId = one(sp.saved);

  const weekRange = `${f.day(week.at)} – ${f.day(week.end)}`;
  const due = f.weekday(week.end);
  const missingTone = counts.missing ? (week.isCurrent ? "neutral" : "warn") : "ok";

  return (
    <>
      <PageHeader
        title="Pre-trip board"
        subtitle={week.isCurrent ? `Week of ${weekRange} · videos due by ${due}` : `Week of ${weekRange}`}
        actions={
          <>
            <nav aria-label="Week" className="inline-flex items-center gap-1 rounded-[10px] bg-sunken p-[3px]">
              <Link href={boardHref({ week: week.prev, show })} scroll={false} aria-label="Previous week" title="Previous week"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-muted hover:bg-surface hover:text-fg"><ChevronLeft className="h-4 w-4" /></Link>
              <span className="num px-1.5 text-[12px] font-medium text-fg">{week.isCurrent ? "This week" : `Week of ${f.day(week.at)}`}</span>
              {week.next ? (
                <Link href={boardHref({ week: week.next === f.weekStart(now).key ? undefined : week.next, show })} scroll={false} aria-label="Next week" title="Next week"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-muted hover:bg-surface hover:text-fg"><ChevronRight className="h-4 w-4" /></Link>
              ) : (
                <IconButton label="This is the current week" disabled className="h-7 w-7"><ChevronRight /></IconButton>
              )}
            </nav>
            {!week.isCurrent && <LinkButton href={boardHref({ show })} variant="ghost" scroll={false}>This week</LinkButton>}
            <LinkButton href="/inspections/defects" variant="secondary"><TriangleAlert />Defects</LinkButton>
          </>
        }
      />

      {savedId && <SavedNotice truckId={savedId} week={week} closeHref={closeHref} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Counter href={href("missing")} active={show === "missing"}>
          <Stat label="Nothing sent" value={counts.missing} tone={missingTone}
            hint={week.isCurrent ? `Missing, not marked or nothing seen · due by ${due}` : "Missing, never marked, or nothing could be seen"} />
        </Counter>
        <Counter href={href("review")} active={show === "review"}>
          <Stat label="To review" value={counts.review} tone={counts.review ? "info" : "ok"} hint="Video in and not reviewed, or something not seen" />
        </Counter>
        <Counter href={href("issues")} active={show === "issues"}>
          <Stat label="Open issues" value={counts.issues} tone={counts.holdingTrucks ? "danger" : counts.issues ? "warn" : "ok"}
            hint={counts.holdingTrucks
              ? `Marked soon or now · ${plural(counts.holdingTrucks, "truck")} held`
              : counts.toConfirm ? `Marked soon or now · ${counts.toConfirm} repaired, to confirm` : "Something marked soon or now"} />
        </Counter>
        <Counter href={href("clean")} active={show === "clean"}>
          <Stat label="Clean" value={counts.clean} hint="Every item marked good" />
        </Counter>
        <Counter href={href("all")} active={show === "all"}>
          <Stat label="Drivers sent" value={<>{counts.sent}<span className="text-[15px] font-medium text-fg-subtle">/{counts.expected}</span></>}
            hint="Videos marked received, whatever the marks" />
        </Counter>
      </div>

      <Card className="mt-4" flush title={
        <span className="flex items-center gap-1.5">
          {show === "needs" ? "Needs a look" : show === "missing" ? "Nothing sent" : show === "review" ? "To review" : show === "issues" ? "Open issues" : show === "clean" ? "Clean this week" : "Drivers sent"}
          <InfoTip>One row per truck. Received videos count as sent whatever the marks. All good is clean; any soon or now is an open issue; any not seen is to review (both, when a video has both); all not seen, missing or never marked is nothing sent. A Now defect holds the truck until someone confirms the repair.</InfoTip>
        </span>
      } actions={show !== "needs" && <Link href={boardHref({ week: weekParam })} scroll={false} className="text-[12px] text-fg-muted hover:text-fg">Show what needs a look</Link>}>
        {main.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />}
            title={rows.length === 0 ? "No trucks yet" : show === "needs" ? "Nothing needs a look this week" : "No trucks here"}
            description={rows.length === 0 ? "Add trucks under Fleet; each one with a driver is expected to send a walk-around video every week."
              : show === "needs" ? "Every expected video is in and reviewed, and no defect is open." : "Pick another counter above."} />
        ) : (
          <BoardTable rows={main} week={week} show={show} f={f} editable={editable} sender={me.name} />
        )}
        {rest.length > 0 && (
          <Disclosure className="border-t border-line" title="Clean and not expected" count={rest.length}
            meta={<span className="hidden text-[11px] text-fg-subtle sm:inline">{plural(rest.filter((r) => r.state === "clean").length, "clean")} · {plural(rest.filter((r) => r.state === "not_expected").length, "not expected", "not expected")}</span>}>
            <div className="border-t border-line">
              <BoardTable rows={rest} week={week} show={show} f={f} editable={editable} sender={me.name} />
            </div>
          </Disclosure>
        )}
      </Card>

      {review && (() => {
        const { title, subtitle, ...form } = review;
        return (
          <UrlDrawer key={`${form.truckId}-${form.week}-${form.reviewed?.stamp ?? ""}`} closeHref={closeHref} wide title={title} subtitle={subtitle}>
            <ReviewForm {...form} />
          </UrlDrawer>
        );
      })()}
    </>
  );
}
