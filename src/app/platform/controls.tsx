"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { makePasswordLink } from "@/app/actions/platform";
import { buttonClass, cn, inputClass } from "@/components/ui";

/** Make a one-time "set your password" link for an account and show it once, to copy and send. */
export function PasswordLinkButton({ userId, email }: { userId: string; email: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  if (url) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <span className="flex items-center gap-1">
          <input readOnly value={url} aria-label={`Password link for ${email}`} onFocus={(e) => e.currentTarget.select()}
            className={cn(inputClass, "num h-7 w-56 py-0 text-[11px]")} />
          <button type="button" className={buttonClass("secondary", "sm")}
            onClick={async () => {
              try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copy the password link", url); return; }
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}>
            {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
          </button>
        </span>
        <span className="text-[11px] text-fg-subtle">Works once, for 3 days. Send it to {email} privately.</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")}
        onClick={() => {
          if (!window.confirm(`Make a link that lets whoever opens it set a new password for ${email}? Their current password keeps working until then.`)) return;
          setError(null);
          start(async () => {
            const res = await makePasswordLink(userId);
            if (res.error) setError(res.error);
            else if (res.url) setUrl(res.url);
          });
        }}>
        <KeyRound />{pending ? "Making…" : "Password link"}
      </button>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </span>
  );
}
