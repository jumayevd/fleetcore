import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { History, Pencil, Phone } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CLAIM_FAULT_LABELS, CLAIM_TYPE_LABELS, CUSTOMER_KIND_LABELS, EQUIPMENT_LABELS, LOAD_STATUS_LABELS, ROLE_LABELS, type LoadStatus, type Role } from "@/lib/constants";
import { ago, date, dateTime, money } from "@/lib/format";
import { Badge, Card, Chip, DL, Disclosure, InfoTip, LinkButton, PageHeader, Progress, cardClass, cn } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents/panel";
import {
  CLAIM_SEVERITY_LABELS, CLAIM_TYPE_DOC_HINT, FAULT_TONE, ageTone, allowedClaimTransitions, claimPhase, claimStatusLabel, daysOpen, recoveryPct,
} from "../shared";
import { staffOptions } from "../options";
import { ClaimStatusActions } from "./status-actions";
import { AssigneeControl } from "./assignee";
import { DeleteClaimButton } from "./delete-button";
import { ClaimNotes, type NoteItem } from "./notes";
import { ClaimTimeline, type TimelineItem } from "./timeline";

export async function generateMetadata({ params }: PageProps<"/claims/[id]">) {
  if (!(await getCurrentUser())) return {};
  const c = await db.claim.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: c?.number ?? "Not found" };
}

export default async function ClaimDetail({ params }: PageProps<"/claims/[id]">) {
  const user = await requireUser("claims.view");
  const { id } = await params;
  const canEdit = can(user.role, "claims.edit");
  const canDelete = can(user.role, "users.manage");

  const claim = await db.claim.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, name: true, phone: true } },
      load: { select: { id: true, reference: true, originCity: true, destCity: true, status: true } },
      truck: { select: { id: true, unitNumber: true, make: true, model: true } },
      trailer: { select: { id: true, unitNumber: true, type: true } },
      customer: { select: { id: true, name: true, kind: true } },
      assignedTo: { select: { id: true, name: true, role: true } },
      createdBy: { select: { name: true } },
      notes: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, role: true } } } },
      _count: { select: { documents: true } },
    },
  });
  if (!claim) notFound();

  const [audit, people] = await Promise.all([
    db.auditLog.findMany({ where: { entity: "claim", entityId: id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
    staffOptions(claim.assignedToId),
  ]);

  // Approved claims are off the open book but not closed: the money is agreed and still to come in.
  const phase = claimPhase(claim.status);
  const open = phase === "open";
  const awaiting = phase === "awaiting";
  const days = daysOpen(claim);
  const tone = ageTone(days, open);
  const transitions = allowedClaimTransitions(claim.status);
  const recovery = recoveryPct(claim.amountClaimed, claim.amountSettled);
  const outstanding = Math.max(0, claim.amountClaimed - (claim.amountSettled ?? 0));
  /** Awaiting payment: nothing received yet, so the agreed amount (the whole claim if none was entered) is still due. */
  const due = claim.amountSettled ?? claim.amountClaimed;
  const typeLabel = CLAIM_TYPE_LABELS[claim.type] ?? claim.type;
  const noDocs = claim._count.documents === 0;

  const timeline: TimelineItem[] = audit
    .filter((e) => e.action !== "note")
    .map((e) => ({ id: e.id, action: e.action, details: e.details, user: e.user?.name ?? null, at: dateTime(e.createdAt), ago: ago(e.createdAt) }));
  if (!audit.some((e) => e.action === "create")) {
    timeline.unshift({ id: "created", action: "create", details: `${claim.number} · ${typeLabel.toLowerCase()} · ${(CLAIM_SEVERITY_LABELS[claim.severity] ?? claim.severity).toLowerCase()}`, user: claim.createdBy?.name ?? null, at: dateTime(claim.createdAt), ago: ago(claim.createdAt) });
  }
  if (claim.closedAt && !audit.some((e) => e.action === "status" && e.details?.includes(`→ ${claim.status}`))) {
    timeline.push({ id: "closed", action: "status", details: `→ ${claim.status}`, user: null, at: dateTime(claim.closedAt), ago: ago(claim.closedAt) });
  }
  const notes: NoteItem[] = claim.notes.map((n) => ({
    id: n.id, body: n.body, author: n.user?.name ?? "System", role: n.user ? ROLE_LABELS[n.user.role as Role] ?? n.user.role : null, at: dateTime(n.createdAt), ago: ago(n.createdAt),
  }));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/claims" className="hover:text-fg">Claims</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{claim.number}</span>
            <span className="font-normal text-fg-muted">{typeLabel}</span>
            <Badge value={claim.severity} label={`${CLAIM_SEVERITY_LABELS[claim.severity] ?? claim.severity} severity`} />
            <Badge value={claim.status} label={claimStatusLabel(claim.status)} dot />
            <Badge value={claim.fault} tone={FAULT_TONE[claim.fault] ?? "neutral"} label={`Fault: ${(CLAIM_FAULT_LABELS[claim.fault] ?? claim.fault).toLowerCase()}`} />
            <Chip tone={tone} className="normal-case tracking-normal"
              title={open ? `Open since ${date(claim.createdAt)}` : awaiting ? `Approved, payment not received yet · open since ${date(claim.createdAt)}` : `Closed ${date(claim.closedAt)}`}>
              <span className="num">{days}d</span>&nbsp;{open ? "open" : awaiting ? "open · awaiting payment" : "to close"}
            </Chip>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Incident <span className="num text-fg">{dateTime(claim.incidentAt)}</span>{claim.location && <> at <span className="text-fg">{claim.location}</span></>}</span>
            <InfoTip>Filed {dateTime(claim.createdAt)} by {claim.createdBy?.name ?? "—"}{claim.closedAt && ` · closed ${dateTime(claim.closedAt)}`}</InfoTip>
          </span>
        }
        actions={
          <>
            {canEdit && transitions.length > 0 && (
              <ClaimStatusActions claimId={id} number={claim.number} status={claim.status} transitions={transitions} amountClaimed={claim.amountClaimed} amountSettled={claim.amountSettled} />
            )}
            {canEdit && <LinkButton href={`/claims/${id}/edit`} variant="secondary"><Pencil />Edit</LinkButton>}
            {canDelete && <DeleteClaimButton claimId={id} number={claim.number} />}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---------------------------------------------------------- left */}
        <div className="space-y-4 xl:col-span-2">
          <Card title="What happened">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">{claim.description}</p>
            {open && noDocs && CLAIM_TYPE_DOC_HINT[claim.type] && (
              <p className="mt-3 rounded-md bg-sunken/60 px-3 py-2 text-[12px] text-fg-muted">
                <span className="font-medium text-fg">Evidence still missing.</span> {CLAIM_TYPE_DOC_HINT[claim.type]}
              </p>
            )}
          </Card>

          {/* Incident date, place, type and fault are in the header; this card is who and what was involved. Secondary detail waits on hover. */}
          <Card title="Involved">
            <DL cols={3} items={[
              ["Load", claim.load
                ? <span key="l" className="flex items-center gap-1.5">
                    <Link href={`/loads/${claim.load.id}`} title={`${claim.load.originCity} → ${claim.load.destCity}`} className="num hover:underline">{claim.load.reference}</Link>
                    <Badge value={claim.load.status} label={LOAD_STATUS_LABELS[claim.load.status as LoadStatus] ?? claim.load.status} />
                  </span>
                : "Not tied to a load"],
              ["Driver", claim.driver
                ? <span key="dr" className="flex items-center gap-2">
                    <Link href={`/drivers/${claim.driver.id}`} className="hover:underline">{claim.driver.name}</Link>
                    {claim.driver.phone && <a href={`tel:${claim.driver.phone}`} className="num inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"><Phone className="h-3 w-3" />{claim.driver.phone}</a>}
                  </span>
                : "—"],
              ["Truck", claim.truck
                ? <Link key="t" href={`/fleet/${claim.truck.id}`} title={`${claim.truck.make} ${claim.truck.model}`} className="num hover:underline">{claim.truck.unitNumber}</Link>
                : "—"],
              ["Trailer", claim.trailer
                ? <Link key="tr" href={`/fleet/trailers/${claim.trailer.id}`} title={EQUIPMENT_LABELS[claim.trailer.type] ?? claim.trailer.type} className="num hover:underline">{claim.trailer.unitNumber}</Link>
                : "—"],
              ["Customer or broker", claim.customer
                ? <Link key="c" href={`/customers/${claim.customer.id}`} title={CUSTOMER_KIND_LABELS[claim.customer.kind] ?? claim.customer.kind} className="hover:underline">{claim.customer.name}</Link>
                : "—"],
            ]} />
          </Card>

          <Card title={<span className="flex items-center gap-1.5">Amounts<InfoTip>{awaiting ? "The bar is the agreed amount as a share of what was claimed. Record the payment when the money arrives." : "The bar is the settled amount as a share of what was claimed."}</InfoTip></span>} actions={recovery != null && <span className={cn("num text-[11px]", recovery >= 80 ? "text-ok" : recovery >= 50 ? "text-fg-muted" : "text-warn")}>{recovery}% {awaiting ? "agreed" : "recovered"}</span>}>
            <div className="grid grid-cols-3 gap-3">
              <Figure label="Claimed" value={money(claim.amountClaimed)} />
              {awaiting ? (
                <>
                  <Figure label="Agreed" value={claim.amountSettled == null ? "—" : money(claim.amountSettled)} muted={claim.amountSettled == null}
                    hint={claim.amountSettled == null ? "no amount entered" : "not received yet"} />
                  <Figure label="Outstanding" value={money(due)} muted={due === 0}
                    hint={claim.amountSettled == null ? "the full claim, not received yet" : "agreed, not received yet"} />
                </>
              ) : (
                <>
                  <Figure label="Settled" value={claim.amountSettled == null ? "—" : money(claim.amountSettled)} muted={claim.amountSettled == null}
                    hint={claim.amountSettled == null ? (open ? "set when approved or paid" : "nothing recovered") : undefined} />
                  <Figure label={open ? "Outstanding" : "Written off"} value={money(outstanding)} muted={outstanding === 0}
                    hint={outstanding === 0 ? "fully recovered" : open ? "still being pursued" : "not recovered"} />
                </>
              )}
            </div>
            {claim.amountClaimed > 0 && (
              <Progress className="mt-3" value={(claim.amountSettled ?? 0) / claim.amountClaimed} tone={recovery == null ? "neutral" : recovery >= 80 ? "ok" : recovery >= 50 ? "progress" : "warn"} />
            )}
          </Card>

          <Card title="Notes" flush actions={notes.length > 0 && <span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{notes.length}</span>}>
            <ClaimNotes claimId={id} notes={notes} canPost />
          </Card>
        </div>

        {/* --------------------------------------------------------- right */}
        <div className="space-y-4">
          <DocumentsPanel
            user={user} target={{ type: "claim", id }} path={`/claims/${id}`} defaultKind="CLAIM_PHOTO"
            description={noDocs && canEdit ? "Photos, reports and estimates attached here make up the claim pack." : undefined}
          />

          <Card title={canEdit ? <span className="flex items-center gap-1.5">Assignee<InfoTip>The assignee gets every Telegram update on this claim.</InfoTip></span> : "Assignee"}>
            <AssigneeControl claimId={id} assignedToId={claim.assignedToId} assignees={people} editable={canEdit} />
          </Card>

          {/* The audit trail is reference material: closed until someone needs it. */}
          <section className={cardClass}>
            <Disclosure title="Timeline" icon={<History />} tone="neutral" count={timeline.length} className="[&>summary]:rounded-lg [&>summary]:py-3">
              <div className="border-t border-line"><ClaimTimeline items={timeline} /></div>
            </Disclosure>
          </section>
        </div>
      </div>
    </>
  );
}

/** One amount. Its one-line note ("not received yet") sits behind an info icon beside the label. */
function Figure({ label, value, hint, muted }: { label: string; value: ReactNode; hint?: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow flex items-center gap-1">{label}{hint && <InfoTip>{hint}</InfoTip>}</p>
      <p className={cn("num mt-1 text-[18px] font-semibold leading-none", muted ? "text-fg-faint" : "text-fg")}>{value}</p>
    </div>
  );
}
