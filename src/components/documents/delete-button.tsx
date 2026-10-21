"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDocument } from "@/app/actions/documents";
import { FormMessage } from "../forms";
import { IconButton } from "../ui";

export function DeleteDocumentButton({ id, name, path }: { id: string; name: string; path: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <FormMessage tone="error" className="mr-1 px-2 py-1 text-[11px]">{error}</FormMessage>}
      <IconButton
        label={`Delete ${name}`}
        disabled={pending}
        className="text-fg-subtle hover:bg-danger-soft hover:text-danger"
        onClick={() => {
          if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
          setError(null);
          // The action throws when the document is gone (someone else deleted it) or not ours to delete;
          // keep that inline instead of letting it replace the whole page with the error boundary.
          start(async () => {
            try {
              await deleteDocument(id, path);
            } catch (e) {
              unstable_rethrow(e); // an expired session redirects to sign-in
              setError("Could not delete this document. Refresh the page and try again.");
            }
          });
        }}
      >
        <Trash2 />
      </IconButton>
    </>
  );
}
