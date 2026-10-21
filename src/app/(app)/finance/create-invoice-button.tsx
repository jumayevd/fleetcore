"use client";

import { useFormStatus } from "react-dom";
import { FilePlus2 } from "lucide-react";
import { buttonClass } from "@/components/ui";

/**
 * Submit button for the "Create invoice" form on the billing queue. The form itself is a native
 * server-action form so the action's redirect to the new invoice is handled by Next.
 */
export function CreateInvoiceButton({ label = "Create invoice" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={buttonClass("primary", "sm")}>
      <FilePlus2 />{pending ? "Creating…" : label}
    </button>
  );
}
