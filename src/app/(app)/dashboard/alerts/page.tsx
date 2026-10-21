import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getDecisions } from "@/lib/alerts";
import { LinkButton, PageHeader } from "@/components/ui";
import { DECISION_PRIORITY_HINTS, DECISION_PRIORITY_LABELS, isDecisionCategory } from "../decision-types";
import { DecisionsTable } from "../decisions";
import { plural, visibleDecisions } from "../lib";

export const metadata = { title: "Needs attention" };

/**
 * Everything open that this role can see, from the same rules as the Today table and the alert bell (which links
 * here), in longer pages. `?cat=` (or the bell's older `?kind=`) opens it on a category.
 */
export default async function AlertsPage({ searchParams }: PageProps<"/dashboard/alerts">) {
  const user = await requireUser("dashboard.view");
  const sp = await searchParams;
  const raw = typeof sp.cat === "string" ? sp.cat : typeof sp.kind === "string" ? sp.kind : undefined;
  const cat = isDecisionCategory(raw) ? raw : "all";

  const rows = visibleDecisions(await getDecisions(), user.role);
  const now = rows.filter((r) => r.priority === "urgent").length;

  return (
    <>
      <PageHeader
        title="Needs attention"
        subtitle={rows.length
          ? <>{plural(rows.length, "open item")}{now ? <> · <span className="text-danger">{now} to sort before the next load</span></> : null}</>
          : "Nothing open"}
        actions={<LinkButton href="/dashboard" variant="secondary">Back to Today</LinkButton>}
      />
      <DecisionsTable key={cat} rows={rows} canEdit={can(user.role, "fleet.edit")} initialCategory={cat} pageSize={25} title="Open items" />
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-subtle">
        {(["urgent", "high", "normal"] as const).map((p) => (
          <span key={p}><span className="font-medium text-fg-muted">{DECISION_PRIORITY_LABELS[p]}</span>: {DECISION_PRIORITY_HINTS[p].toLowerCase()}</span>
        ))}
      </p>
    </>
  );
}
