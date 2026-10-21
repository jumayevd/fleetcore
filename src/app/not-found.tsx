import { LinkButton } from "@/components/ui";
import { getSessionContext } from "@/lib/session";

/** Root 404: unmatched URLs for the whole app (no shell — the visitor may be signed out). */
export default async function NotFound() {
  const { accounts, active } = await getSessionContext();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <title>Page not found · FleetOps</title>
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8">
        <p className="eyebrow">Error <span className="num">404</span></p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-fg">Page not found</h1>
        <p className="mt-2 text-[13px] leading-5 text-fg-muted">
          The address may be mistyped, or the page may have moved. Check the link, or start again from
          {accounts.length ? " your overview." : " the sign-in page."}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {active ? <LinkButton href="/dashboard" variant="primary">Go to overview</LinkButton>
            : accounts.length ? <LinkButton href="/select" variant="primary">Choose a company</LinkButton>
            : <LinkButton href="/login" variant="primary">Sign in</LinkButton>}
        </div>
      </div>
    </main>
  );
}
