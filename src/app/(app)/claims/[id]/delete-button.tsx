"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { deleteClaim } from "@/app/actions/claims";

/** Permanent delete (users.manage). Confirms first; the action removes notes and files and redirects to /claims. */
export function DeleteClaimButton({ claimId, number }: { claimId: string; number: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button" disabled={pending} title="Delete claim permanently"
        className={cn(buttonClass("ghost"), "text-danger hover:bg-danger-soft hover:text-danger")}
        onClick={() => {
          if (!window.confirm(`Delete ${number} permanently? Its notes and documents are removed too. This cannot be undone.`)) return;
          setError(null);
          start(async () => {
            try {
              await deleteClaim(claimId);
            } catch (e) {
              setError(e instanceof Error && e.message ? e.message : "Could not delete the claim.");
            }
          });
        }}
      >
        <Trash2 />{pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
