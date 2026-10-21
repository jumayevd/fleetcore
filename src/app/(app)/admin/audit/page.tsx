import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { rootDb } from "@/lib/db-root";
import { daysAgo, number } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { Badge, Card, FilterPills, InfoTip, LinkButton, PageHeader, Table } from "@/components/ui";
import { AuditFilters } from "./filters";
import { auditHref, isoDay, type AuditFilterParams } from "./shared";
import { actionLabel, actionTone, entityHref, entityLabel } from "./links";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;
const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** "2026-10-31" → "2026-11-01" (calendar arithmetic, no time zone involved). */
const nextDay = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const me = await requireUser("audit.view");
  const sp = await searchParams;
  const params: AuditFilterParams = {
    entity: str(sp.entity), user: str(sp.user), action: str(sp.action), from: isoDay(str(sp.from)), to: isoDay(str(sp.to)), q: str(sp.q),
  };
  const requested = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const f = await getFormat();
  const dateTime = f.dateTime;

  const where: Prisma.AuditLogWhereInput = {};
  if (params.entity) where.entity = params.entity;
  if (params.action) where.action = params.action;
  if (params.user === "system") where.userId = null;
  else if (params.user) where.userId = params.user;
  if (params.from || params.to) {
    where.createdAt = {
      // Whole days in the company's time zone.
      ...(params.from ? { gte: f.parseDate(params.from) ?? new Date(`${params.from}T00:00:00`) } : {}),
      ...(params.to ? { lt: f.parseDate(nextDay(params.to)) ?? new Date(new Date(`${params.to}T00:00:00`).getTime() + 86_400_000) } : {}),
    };
  }
  if (params.q) where.details = { contains: params.q, mode: "insensitive" };

  // Entity counts respect every filter except the entity itself, so the pills stay meaningful.
  const { entity: _entity, ...whereNoEntity } = where; // eslint-disable-line @typescript-eslint/no-unused-vars

  const pageRows = (p: number) => db.auditLog.findMany({
    where, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: { select: { id: true, name: true, email: true } } },
  });
  const [requestedRows, total, entities, actions, users, last24] = await Promise.all([
    pageRows(requested),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["entity"], where: whereNoEntity, _count: true, orderBy: { _count: { entity: "desc" } } }),
    db.auditLog.groupBy({ by: ["action"], _count: true, orderBy: { action: "asc" } }),
    // People who changed something in THIS company (users are global; never list them unfiltered).
    rootDb.user.findMany({ where: { audits: { some: { companyId: me.company.id } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.auditLog.count({ where: { createdAt: { gte: daysAgo(1) } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A page past the end (old link, hand-edited URL, narrower filter) shows the last page instead of an empty one.
  const page = Math.min(requested, pages);
  const rows = page === requested ? requestedRows : await pageRows(page);
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, page * PAGE_SIZE);
  const filtered = Object.values(params).some(Boolean);
  const totalForPills = entities.reduce((a, e) => a + e._count, 0);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <span><span className="num">{number(last24)}</span> entries in the last 24 hours</span>
            <InfoTip>Every change in this company, who made it and when. The log is append-only.</InfoTip>
          </span>
        }
        actions={<LinkButton href="/admin/members" variant="secondary">Members</LinkButton>}
      />

      <div className="mb-3 space-y-2">
        <FilterPills active={params.entity ?? "all"} items={[
          { key: "all", href: auditHref(params, { entity: undefined }), label: "All", count: totalForPills },
          ...entities.map((e) => ({ key: e.entity, href: auditHref(params, { entity: e.entity }), label: entityLabel(e.entity), count: e._count })),
        ]} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AuditFilters params={params}
            users={users.map((u) => ({ value: u.id, label: u.name }))}
            actions={actions.map((a) => ({ value: a.action, label: actionLabel(a.action), count: a._count }))} />
          <p className="text-[11px] text-fg-subtle">
            {total ? <>Showing <span className="num">{first}–{last}</span> of <span className="num">{number(total)}</span></> : "No entries"}{filtered && " · filtered"}
          </p>
        </div>
      </div>

      <Card flush>
        <Table head={["When", "Who", "Action", "Entity", "Details"]} dense
          empty={rows.length === 0}
          emptyTitle={page > 1 ? "Nothing on this page" : filtered ? "Nothing matches these filters" : "No activity yet"}
          emptyDescription={page > 1 ? "Go back to the first page for the latest entries." : filtered ? "Widen the date range or clear a filter." : "Changes made in the app are recorded here automatically."}>
          {rows.map((r) => {
            const href = entityHref(r.entity, r.entityId);
            return (
              <tr key={r.id}>
                <td className="num whitespace-nowrap text-[12px] text-fg-muted" title={r.createdAt.toISOString()}>{dateTime(r.createdAt)}</td>
                <td className="min-w-40" title={r.user ? r.user.email : "Automatic change"}>
                  {r.user ? <Link href={auditHref(params, { user: r.user.id })} className="hover:underline">{r.user.name}</Link> : <span className="text-fg-muted">System</span>}
                </td>
                <td><Badge value={r.action} tone={actionTone(r.action)} label={actionLabel(r.action)} /></td>
                <td className="whitespace-nowrap">
                  {href ? <Link href={href} className="text-fg hover:underline">{entityLabel(r.entity)}</Link> : <span className="text-fg-muted">{entityLabel(r.entity)}</span>}
                  {r.entityId && !href && <span className="num ml-1.5 text-[11px] text-fg-faint">{r.entityId.slice(-6)}</span>}
                </td>
                <td className="max-w-xl truncate text-fg-muted" title={r.details ?? undefined}>{r.details ?? <span className="text-fg-faint">—</span>}</td>
              </tr>
            );
          })}
        </Table>
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px]">
            <span className="text-fg-subtle">Page <span className="num">{page}</span> of <span className="num">{pages}</span></span>
            <div className="flex items-center gap-1">
              {page > 1 ? <LinkButton href={auditHref(params, { page: page - 1 })} variant="secondary" size="sm">Newer</LinkButton> : <span className="h-7" />}
              {page < pages && <LinkButton href={auditHref(params, { page: page + 1 })} variant="secondary" size="sm">Older</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
