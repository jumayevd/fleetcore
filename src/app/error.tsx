"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";

/** Root error boundary. Replaces the page (and shell) when a segment below throws. */
export default function RootError({ error, reset, retry }: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Next 16.3+: re-fetches and re-renders the failed segment. */
  retry?: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);
  const again = retry ?? reset;
  const showMessage = process.env.NODE_ENV !== "production" && error.message;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <title>Something went wrong · FleetOps</title>
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8">
        <p className="eyebrow">Unexpected error</p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-fg">Something went wrong</h1>
        <p className="mt-2 text-[13px] leading-5 text-fg-muted">
          The page could not be rendered. Trying again fixes most temporary problems. If it keeps happening,
          send the reference below to your administrator.
        </p>
        {error.digest && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-sunken px-2 py-1 text-[11px] text-fg-muted">
            Reference <span className="num text-fg">{error.digest}</span>
          </p>
        )}
        {showMessage && (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-danger-soft p-3 text-[11px] leading-4 text-danger">{error.message}</pre>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => again()}><RotateCcw /> Try again</Button>
          <LinkButton href="/" variant="secondary">Go to home</LinkButton>
        </div>
      </div>
    </main>
  );
}
