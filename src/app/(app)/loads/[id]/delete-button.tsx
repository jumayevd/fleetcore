"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";
import { deleteLoad } from "@/app/actions/loads";
import { actionError } from "../shared";

/** Permanent delete (users.manage, booked or cancelled loads only). Confirms first; the action redirects to /loads. */
export function DeleteLoadButton({ loadId, reference }: { loadId: string; reference: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button" disabled={pending}
        className={cn(buttonClass("ghost", "sm"), "text-danger hover:bg-danger-soft hover:text-danger")}
        onClick={() => {
          if (!window.confirm(`Delete ${reference} permanently? Its stops, events and documents are removed. This cannot be undone.`)) return;
          setError(null);
          start(async () => {
            const fallback = "Could not delete the load. Only booked or cancelled loads can be deleted — reload the page to see its current status.";
            try {
              const res: unknown = await deleteLoad(loadId);
              setError(actionError(res, undefined, fallback));
            } catch (e) {
              setError(actionError(undefined, e, fallback));
            }
          });
        }}
      >
        <Trash2 />{pending ? "Deleting…" : "Delete load permanently"}
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
