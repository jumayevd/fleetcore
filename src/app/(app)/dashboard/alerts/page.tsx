import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAlerts } from "@/lib/alerts";
import { Card, EmptyState, FilterPills, LinkButton, PageHeader, StatusDot, Table } from "@/components/ui";
import { KINDS, KIND_LABEL, groupAlerts, isKind, plural, visibleAlerts } from "../lib";

export const metadata = { title: "Needs attention" };

/**
 * Every open exception this role can act on, critical first. The overview's "Needs attention" card links here.
 * One severity dot per row is the only colour, so the list stays readable when it is long.
 */
export default async function AlertsPage({ searchParams }: PageProps<"/dashboard/alerts">) {
  const user = await requireUser("dashboard.view");
  const sp = await searchParams;
  const kind = isKind(sp.kind) ? sp.kind : undefined;

  const alerts = visibleAlerts(await getAlerts(), user.role);
  const groups = groupAlerts(alerts);
  const critical = alerts.filter((a) => a.level === "critical").length;
  const rows = alerts
    .filter((a) => !kind || a.kind === kind)
    .sort((a, b) => Number(b.level === "critical") - Number(a.level === "critical"));

  const pills = [
    { key: "all", href: "/dashboard/alerts", label: "All", count: alerts.length },
    ...KINDS.map((k) => ({ key: k, href: `/dashboard/alerts?kind=${k}`, label: KIND_LABEL[k], count: groups.find((g) => g.kind === k)?.items.length ?? 0 })),
  ].filter((p) => p.key === "all" || p.count > 0);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/dashboard" className="hover:text-fg">Overview</Link>}
        title="Needs attention"
        subtitle={alerts.length
          ? <>{plural(alerts.length, "open item")}{critical ? <> · <span className="text-danger">{critical} critical</span></> : null}</>
          : "Nothing open"}
      />
      {pills.length > 1 && <div className="mb-4"><FilterPills items={pills} active={kind ?? "all"} /></div>}

      <Card flush>
        {rows.length === 0 ? (
          kind && alerts.length ? (
            <EmptyState
              title={`No ${KIND_LABEL[kind].toLowerCase()} items`}
              description="Other kinds still have open items."
              action={<LinkButton href="/dashboard/alerts" variant="secondary" size="sm">Show all</LinkButton>}
            />
          ) : (
            <EmptyState title="All clear" description="Nothing needs a decision right now. Items appear here as compliance dates approach, loads run late, invoices age or claims stay open." />
          )
        ) : (
          <Table dense head={["What", "Detail", "Kind", <span key="open" className="sr-only">Open</span>]}>
            {rows.map((a, i) => (
              <tr key={`${a.href}-${i}`}>
                <td className="font-medium text-fg">
                  <Link href={a.href} className="inline-flex items-center gap-2.5 hover:text-accent-text">
                    <StatusDot tone={a.level === "critical" ? "danger" : "warn"} />
                    <span>{a.title}</span>
                    {a.level === "critical" && <span className="sr-only">(critical)</span>}
                  </Link>
                </td>
                <td className="max-w-md truncate text-fg-muted" title={a.detail}>{a.detail}</td>
                <td className="whitespace-nowrap text-fg-muted">{KIND_LABEL[a.kind]}</td>
                <td className="whitespace-nowrap text-right"><Link href={a.href} className="text-[12px] font-medium text-fg-muted hover:text-fg">Open →</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <p className="mt-3 flex items-center gap-4 text-[12px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="danger" /> Critical</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot tone="warn" /> Warning</span>
      </p>
    </>
  );
}
