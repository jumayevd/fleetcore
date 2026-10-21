"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";

/** Error boundary inside the app shell: the sidebar and top bar stay, only the page content is replaced. */
export default function AppError({ error, reset, retry }: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Next 16.3+: re-fetches the segment. `reset` only re-renders the cached (failed) payload. */
  retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-fg">This page hit a problem</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            The rest of the app is fine. Try the page again; if it keeps failing, the details below help whoever looks into it.
          </p>
          {error.digest && <p className="num mt-2 text-[11px] text-fg-subtle">Reference {error.digest}</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => (retry ?? reset)()}><RotateCcw className="h-4 w-4" />Try again</Button>
        <Link href="/dashboard" className={buttonClass("secondary")}>Go to overview</Link>
      </div>
    </div>
  );
}
