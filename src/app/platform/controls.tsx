"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Building2, Check, Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { makePasswordLink, setCompanyArchived, setCompanyCreator, setPlatformOwner } from "@/app/actions/platform";
import { buttonClass, cn, inputClass } from "@/components/ui";

/** Archive a company (contract ended; every row is kept) or restore it. */
export function ArchiveCompanyButton({ companyId, name, archived }: { companyId: string; name: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")}
        title={archived ? `Restore ${name}` : `Archive ${name}`}
        onClick={() => {
          const question = archived
            ? `Restore ${name}? Its members can open it and change things again, and its TrackPro sync starts again.`
            : `Archive ${name}?\n\nEverything in it is kept. Its members can't open it any more, its open invitations are withdrawn and its TrackPro sync stops. You can still open it here, read-only, and restore it at any time.`;
          if (!window.confirm(question)) return;
          setError(null);
          start(async () => {
            const res = await setCompanyArchived(companyId, !archived);
            if (res.error) setError(res.error);
          });
        }}>
        {archived ? <ArchiveRestore /> : <Archive />}{pending ? "Saving…" : archived ? "Restore" : "Archive"}
      </button>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </span>
  );
}

/** Make an account a platform owner, or take that away. */
export function PlatformOwnerToggle({ userId, email, owner }: { userId: string; email: string; owner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} aria-pressed={owner} className={buttonClass("ghost", "sm")}
        title={owner ? `Take platform owner from ${email}` : `Make ${email} a platform owner`}
        onClick={() => {
          const question = owner
            ? `Take platform owner from ${email}? They lose this console and keep only their own company memberships.`
            : `Make ${email} a platform owner?\n\nThey will see every company and account here, can open any company with an owner's rights, archive and restore companies, and make other platform owners.`;
          if (!window.confirm(question)) return;
          setError(null);
          start(async () => {
            const res = await setPlatformOwner(userId, !owner);
            if (res.error) setError(res.error);
          });
        }}>
        {owner ? <ShieldOff /> : <ShieldCheck />}{pending ? "Saving…" : owner ? "Remove platform owner" : "Make platform owner"}
      </button>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </span>
  );
}

/** Allow (or stop) an account creating companies. */
export function CompanyCreatorToggle({ userId, email, allowed }: { userId: string; email: string; allowed: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} aria-pressed={allowed} className={buttonClass("ghost", "sm")}
        title={allowed ? `${email} can create companies` : `Let ${email} create companies`}
        onClick={() => {
          if (!allowed && !window.confirm(`Let ${email} create new companies on FleetCore? They become the owner of each company they create.`)) return;
          setError(null);
          start(async () => {
            const res = await setCompanyCreator(userId, !allowed);
            if (res.error) setError(res.error);
          });
        }}>
        <Building2 />{pending ? "Saving…" : allowed ? "Stop creating companies" : "Allow creating companies"}
      </button>
      {error && <span role="alert" className="max-w-56 text-[11px] text-danger">{error}</span>}
    </span>
  );
}

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
