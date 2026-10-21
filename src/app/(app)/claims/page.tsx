import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CLAIM_FAULT_LABELS, CLAIM_TYPE_LABELS } from "@/lib/constants";
import { date, money, number } from "@/lib/format";
import { Badge, Card, Chip, FilterPills, InfoTip, LinkButton, PageHeader, Stat, Table, Tabs, cn } from "@/components/ui";
import { LIST_INCLUDE, claimKpis, claimWhere, parseClaimFilters, sortForTable } from "./query";
import { CLAIM_SEVERITY_LABELS, FAULT_TONE, ageTone, claimPhase, claimStatusLabel, claimsHref, daysOpen, hasClaimFilters, type ClaimPhase } from "./shared";
import { ClaimFilterBar } from "./filters";
import { ClaimRowMenu } from "./row-menu";
import { ClaimAnalytics } from "./analytics";

export const metadata = { title: "Claims" };

const TAKE = 300;

export default async function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  const user = await requireUser("claims.view");
  const canEdit = can(user.role, "claims.edit");
  const f = parseClaimFilters(await searchParams);
  const where = claimWhere(f);
  const analytics = f.tab === "analytics";

  const [kpi, byStatus, total, rows] = await Promise.all([
    claimKpis(),
    db.claim.groupBy({ by: ["status"], where: claimWhere(f, { withStatus: false }), _count: true }),
    db.claim.count({ where }),
    analytics ? Promise.resolve([]) : db.claim.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: "desc" }, take: TAKE }),
  ]);
  const claims = sortForTable(rows);
  const countIn = (phase: ClaimPhase) => byStatus.filter((s) => claimPhase(s.status) === phase).reduce((a, s) => a + s._count, 0);
  const allCount = byStatus.reduce((a, s) => a + s._count, 0);
  const openCount = countIn("open");
  const awaitingCount = countIn("awaiting");
  const filtered = hasClaimFilters(f);
  const pill = f.status === "open" || f.status === "closed" || f.status === "APPROVED" ? f.status : f.status ? "status" : "ALL";

  return (
    <>
      <PageHeader
        eyebrow="Money & safety"
        title="Claims"
        actions={canEdit && <LinkButton href="/claims/new"><Plus />New claim</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Link href={claimsHref({}, { status: "open" })} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Stat className="h-full transition-colors group-hover:border-line-strong" label="Open claims" value={number(kpi.openCount)}
            tone={kpi.openCount === 0 ? "ok" : kpi.severeOpen || kpi.oldestOpen > 45 ? "danger" : kpi.oldestOpen > 14 ? "warn" : "neutral"}
            hint={kpi.openCount ? `${kpi.severeOpen} high or critical · oldest ${kpi.oldestOpen}d` : "nothing open — the book is clean"} />
        </Link>
        <Stat label="Open amount claimed" value={money(kpi.openClaimed)}
          hint={kpi.contestedCount ? `${money(kpi.contestedClaimed)} contested across ${kpi.contestedCount}` : "nothing in negotiation or dispute"} />
        <Stat label="Settled YTD" value={money(kpi.settledYtd)} tone={kpi.recoveryYtdPct != null && kpi.recoveryYtdPct < 50 ? "warn" : "neutral"}
          hint={kpi.settledYtdCount || kpi.unrecoveredYtdCount
            ? `${kpi.recoveryYtdPct}% recovered · ${kpi.settledYtdCount} settled${kpi.unrecoveredYtdCount ? `, ${kpi.unrecoveredYtdCount} denied` : ""}`
            : "no settlements this year yet"} />
        <Stat label="Avg days to close" value={kpi.avgClose == null ? "—" : `${kpi.avgClose}d`}
          tone={kpi.avgClose == null ? "neutral" : kpi.avgClose > 45 ? "warn" : "ok"}
          hint={kpi.closedCount ? `median ${kpi.medianClose}d · ${kpi.closedCount} closed in 12 months` : "no claims closed in the last 12 months"} />
        <Stat label="Claims per 100 loads" value={kpi.per100Loads == null ? "—" : kpi.per100Loads.toFixed(1)}
          tone={kpi.per100Loads == null ? "neutral" : kpi.per100Loads > 3 ? "warn" : "neutral"}
          hint={`${number(kpi.claims12)} claims on ${number(kpi.loads12)} loads · 12 months`} />
      </div>

      <Tabs active={f.tab} tabs={[
        { key: "table", label: "Claims", href: claimsHref(f, { tab: undefined }), count: filtered || analytics ? total : undefined },
        { key: "analytics", label: "Analytics", href: claimsHref(f, { tab: "analytics" }) },
      ]} />

      {/* The active pill's count is the number of claims listed; the footer says when the table is cut short. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ClaimFilterBar values={f} />
        <FilterPills active={pill} items={[
          { key: "ALL", href: claimsHref(f, { status: undefined }), label: "All", count: allCount },
          { key: "open", href: claimsHref(f, { status: "open" }), label: "Open", count: openCount },
          ...(awaitingCount > 0 || pill === "APPROVED"
            ? [{ key: "APPROVED", href: claimsHref(f, { status: "APPROVED" }), label: "Awaiting payment", count: awaitingCount }] : []),
          { key: "closed", href: claimsHref(f, { status: "closed" }), label: "Closed", count: countIn("closed") },
          ...(pill === "status" && f.status ? [{ key: "status", href: claimsHref(f, {}), label: claimStatusLabel(f.status), count: total }] : []),
        ]} />
      </div>

      {analytics ? (
        <ClaimAnalytics where={where} filters={f} />
      ) : (
        <Card flush>
          <Table dense
            head={[<span key="claim" className="inline-flex items-center gap-1">Claim<InfoTip>Open claims first, most severe and oldest at the top.</InfoTip></span>, "Type", "Severity", "Status", "Days open", "Driver", "Load", "Truck", "Incident", "Fault",
              <span key="amt" className="block text-right">Claimed · settled</span>, "Docs", "Assignee", ""]}
            empty={claims.length === 0}
            emptyTitle={filtered ? "No claims match these filters" : "No claims yet"}
            emptyDescription={filtered ? "Try another type, status or severity, or clear the search." : canEdit ? "File one with New claim, or from a load's row menu (File a claim) so the driver, unit and customer come prefilled." : "Claims appear here once dispatch or the fleet team files one."}
          >
            {claims.map((c) => {
              const phase = claimPhase(c.status);
              const open = phase === "open";
              const days = daysOpen(c);
              const tone = ageTone(days, open);
              const noDocs = open && c.status !== "REPORTED" && c._count.documents === 0;
              return (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/claims/${c.id}`} title={c.location ?? undefined} className="num font-medium text-fg hover:underline">{c.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{CLAIM_TYPE_LABELS[c.type] ?? c.type}</td>
                  <td><Badge value={c.severity} label={CLAIM_SEVERITY_LABELS[c.severity] ?? c.severity} /></td>
                  <td><Badge value={c.status} label={claimStatusLabel(c.status)} dot /></td>
                  <td className="whitespace-nowrap">
                    {open
                      ? tone === "neutral"
                        ? <span className="num text-fg-muted">{days}d</span>
                        : <Badge value="" tone={tone} label={`${days}d`} className="num" />
                      : phase === "awaiting"
                        ? <span className="num text-fg-muted" title={`Approved, payment not received yet · open since ${date(c.createdAt)}`}>{days}d</span>
                        : <span className="num text-fg-subtle" title={`Closed ${date(c.closedAt)}`}>{days}d</span>}
                  </td>
                  <td className="whitespace-nowrap">{c.driver ? <Link href={`/drivers/${c.driver.id}`} className="hover:underline">{c.driver.name}</Link> : <span className="text-fg-faint">—</span>}</td>
                  <td>{c.load ? <Link href={`/loads/${c.load.id}`} className="num hover:underline">{c.load.reference}</Link> : <span className="text-fg-faint">—</span>}</td>
                  <td>
                    {c.truck
                      ? <Link href={`/fleet/${c.truck.id}`} title={c.trailer ? `Trailer ${c.trailer.unitNumber}` : undefined} className="num hover:underline">{c.truck.unitNumber}</Link>
                      : c.trailer ? <span className="num text-fg-muted" title="Trailer">{c.trailer.unitNumber}</span> : <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="num whitespace-nowrap text-fg-muted">{date(c.incidentAt)}</td>
                  <td><Badge value={c.fault} tone={FAULT_TONE[c.fault] ?? "neutral"} label={CLAIM_FAULT_LABELS[c.fault] ?? c.fault} /></td>
                  <td className="num whitespace-nowrap text-right">
                    <span className="font-medium">{money(c.amountClaimed)}</span>
                    <span className={cn("text-fg-subtle", c.amountSettled != null && c.amountSettled > 0 && phase !== "awaiting" && "text-ok")}
                      title={phase === "awaiting" && c.amountSettled != null ? "Agreed, not received yet" : undefined}> · {c.amountSettled == null ? "—" : money(c.amountSettled)}</span>
                  </td>
                  <td>
                    {noDocs ? <Chip tone="warn">No docs</Chip>
                      : c._count.documents > 0
                        ? <span className="num inline-flex items-center gap-1 text-fg-muted"><FileText className="h-3.5 w-3.5 text-fg-subtle" />{c._count.documents}</span>
                        : <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap">{c.assignedTo ? c.assignedTo.name : phase !== "closed" ? <span className="text-warn">Unassigned</span> : <span className="text-fg-faint">—</span>}</td>
                  <td className="w-8 text-right"><ClaimRowMenu id={c.id} number={c.number} canEdit={canEdit} /></td>
                </tr>
              );
            })}
          </Table>
          {total > claims.length && (
            <p className="border-t border-line px-4 py-2 text-[12px] text-fg-muted">
              Showing the first {number(claims.length)} of {number(total)} claims — narrow the filters or search to see the rest.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
