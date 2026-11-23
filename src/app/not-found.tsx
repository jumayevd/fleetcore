import { LinkButton } from "@/components/ui";

/**
 * Root 404: unmatched URLs for the whole app (no shell; the visitor may be signed out). Static on purpose: it is part of
 * every route's tree, and reading the session here would make every page, the public site included, render per request.
 * /login sends people who are already signed in straight to their fleet.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <title>Page not found · FleetCore</title>
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8">
        <p className="eyebrow">Error <span className="num">404</span></p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-fg">Page not found</h1>
        <p className="mt-2 text-[13px] leading-5 text-fg-muted">
          The address may be mistyped, or the page may have moved. Check the link, or start again from your fleet.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton href="/login" variant="primary">Go to your fleet</LinkButton>
          <LinkButton href="/" variant="secondary">FleetCore home</LinkButton>
        </div>
      </div>
    </main>
  );
}
