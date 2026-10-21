import { Card, Kbd, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

/** 404 inside the signed-in shell: a record that doesn't exist, was removed, or belongs to another company. */
export default async function AppNotFound() {
  const user = await getCurrentUser();
  return (
    <>
      <title>Not found · FleetOps</title>
      <div className="mx-auto mt-10 max-w-lg">
        <Card bodyClassName="p-6">
          <p className="eyebrow">Error <span className="num">404</span></p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-fg">Not found in {user?.company.name ?? "this company"}</h1>
          <p className="mt-2 text-[13px] leading-5 text-fg-muted">
            The record may have been deleted, or it belongs to another company. If you opened a link from another
            company, switch to it from the company menu at the top of the sidebar.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <LinkButton href="/dashboard" variant="primary">Go to overview</LinkButton>
            <LinkButton href="/select" variant="secondary">All companies</LinkButton>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">Search <Kbd>⌘K</Kbd></span>
          </div>
        </Card>
      </div>
    </>
  );
}
