import { Card, Kbd, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

/** 404 inside the signed-in shell: a record that doesn't exist or was removed. */
export default async function AppNotFound() {
  const user = await getCurrentUser();
  const driver = user?.role === "DRIVER";
  return (
    <>
      <title>Not found · FleetOps</title>
      <div className="mx-auto mt-10 max-w-lg">
        <Card bodyClassName="p-6">
          <p className="eyebrow">Error <span className="num">404</span></p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-fg">This page doesn&apos;t exist</h1>
          <p className="mt-2 text-[13px] leading-5 text-fg-muted">
            The record may have been deleted, or the link is out of date. Boards and tables always show the current data,
            so start from one of them or search for what you need.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <LinkButton href={user ? homeFor(user.role) : "/"} variant="primary">{driver ? "Go to my trips" : "Go to home"}</LinkButton>
            {!driver && <LinkButton href="/loads" variant="secondary">Open loads</LinkButton>}
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">Search <Kbd>⌘K</Kbd></span>
          </div>
        </Card>
      </div>
    </>
  );
}
