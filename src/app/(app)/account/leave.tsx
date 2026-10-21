"use client";

import { useState, useTransition } from "react";
import { leaveCompany } from "@/app/actions/auth";
import { FormMessage } from "@/components/forms";
import { buttonClass } from "@/components/ui";

export function LeaveCompanyButton({ company }: { company: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")}
        onClick={() => {
          if (!window.confirm(`Leave ${company}? You will lose access to its trucks, drivers and documents until someone invites you again.`)) return;
          start(async () => {
            const res = await leaveCompany();
            if (res?.error) setError(res.error);
          });
        }}>
        {pending ? "Leaving…" : "Leave"}
      </button>
      {error && <FormMessage tone="error" className="max-w-64">{error}</FormMessage>}
    </div>
  );
}
