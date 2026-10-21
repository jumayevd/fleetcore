"use client";

import { useState, useTransition } from "react";
import { Check, Copy, X } from "lucide-react";
import { removeMember, revokeInvite, setMemberRole } from "@/app/actions/members";
import { buttonClass, cn, inputClass } from "@/components/ui";

/** Inline role picker: saves on change, shows a refusal next to it. */
export function MemberRole({ membershipId, role, options }: { membershipId: string; role: string; options: { value: string; label: string }[] }) {
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <select aria-label="Role" value={value} disabled={pending} className={cn(inputClass, "h-7 w-40 py-0 text-[12px]")}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          setError(null);
          start(async () => {
            const res = await setMemberRole(membershipId, next);
            if (res?.error) { setError(res.error); setValue(prev); }
          });
        }}>
        {/* The current role may be one this person can't hand out (an admin looking at an owner): keep it listed. */}
        {!options.some((o) => o.value === role) && <option value={role}>{role}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </div>
  );
}

export function RemoveMember({ membershipId, name, company }: { membershipId: string; name: string; company: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")}
        onClick={() => {
          if (!window.confirm(`Remove ${name} from ${company}? Their account stays; they just lose access here.`)) return;
          start(async () => {
            const res = await removeMember(membershipId);
            if (res?.error) setError(res.error);
          });
        }}>
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </span>
  );
}

export function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title={url} className={buttonClass("secondary", "sm")}
      onClick={async () => {
        try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copy the invitation link", url); return; }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}>
      {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}
    </button>
  );
}

export function RevokeInvite({ inviteId }: { inviteId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-label="Withdraw invitation" title="Withdraw invitation" className={buttonClass("ghost", "sm")}
      onClick={() => start(() => revokeInvite(inviteId))}>
      <X />
    </button>
  );
}
