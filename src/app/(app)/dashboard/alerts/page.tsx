import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAlerts } from "@/lib/alerts";
import { Card, EmptyState, FilterPills, IconTile, InfoTip, LinkButton, PageHeader, StatusDot, Table } from "@/components/ui";
import { KINDS, KIND_HINT, KIND_LABEL, groupAlerts, isKind, plural, visibleAlerts } from "../lib";
import { KIND_HUE, KIND_ICON } from "../needs-you";

export const metadata = { title: "Needs attention" };

/**
 * Every open item this role can act on, critical first, filterable by kind. The overview's "Needs attention" card
 * and the alert bell link here. One severity dot per row is the only status colour, so a long list stays readable.
 */
export default async function AlertsPage({ searchParams }: PageProps<"/dashboard/alerts">) {
  const user = await requireUser("dashboard.view");
  const sp = await searchParams;
  const kind = isKind(sp.kind) ? sp.kind : undefined;

  const alerts = visibleAlerts(await getAlerts(), user.role);
  const groups = groupAlerts(alerts);
  const critical = alerts.filter((a) => a.level === "critical").length;
  const rows = alerts.filter((a) => !kind || a.kind === kind);

  const pills = [
    { key: "all", href: "/dashboard/alerts", label: "All", count: alerts.length },
    ...KINDS.map((k) => ({ key: k, href: `/dashboard/alerts?kind=${k}`, label: KIND_LABEL[k], count: groups.find((g) => g.kind === k)?.items.length ?? 0 })),
  ].filter((p) => p.key === "all" || p.count > 0 || p.key === kind);

  return (
    <>
      <PageHeader
        title="Needs attention"
        subtitle={alerts.length
          ? <>{plural(alerts.length, "open item")}{critical ? <> · <span className="text-danger">{critical} critical</span></> : null}</>
          : "Nothing open"}
      />
      {pills.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <FilterPills items={pills} active={kind ?? "all"} />
          {kind && <InfoTip>{KIND_HINT[kind]}</InfoTip>}
        </div>
      )}

      <Card flush>
        {rows.length === 0 ? (
          kind && alerts.length ? (
            <EmptyState
              title={`No ${KIND_LABEL[kind].toLowerCase()} items`}
              description="Other kinds still have open items."
              action={<LinkButton href="/dashboard/alerts" variant="secondary" size="sm">Show all</LinkButton>}
            />
          ) : (
            <EmptyState
              title="All clear"
              description="Nothing needs a decision right now. Items appear here a month before paperwork expires, as trucks near their PM, when a booked job slips, and when a truck can't run."
            />
          )
        ) : (
          <Table dense head={["What", "Detail", "Kind", <span key="open" className="sr-only">Open</span>]}>
            {rows.map((a, i) => {
              const Icon = KIND_ICON[a.kind];
              return (
                <tr key={`${a.href}-${a.title}-${i}`}>
                  <td className="font-medium text-fg">
                    <Link href={a.href} className="inline-flex items-center gap-2.5 hover:text-accent-text">
                      <StatusDot tone={a.level === "critical" ? "danger" : "warn"} />
                      <span>{a.title}</span>
                      {a.level === "critical" && <span className="sr-only">(critical)</span>}
                    </Link>
                  </td>
                  <td className="max-w-md truncate text-fg-muted" title={a.detail}>{a.detail}</td>
                  <td className="whitespace-nowrap text-fg-muted">
                    <span className="inline-flex items-center gap-2"><IconTile size="sm" tone={KIND_HUE[a.kind]}><Icon aria-hidden /></IconTile>{KIND_LABEL[a.kind]}</span>
                  </td>
                  <td className="whitespace-nowrap text-right"><Link href={a.href} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open →</Link></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <p className="mt-3 flex items-center gap-4 text-[12px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="danger" /> Critical: expired, overdue or over a limit</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="warn" /> Warning: coming up or needs a look</span>
      </p>
    </>
  );
}
