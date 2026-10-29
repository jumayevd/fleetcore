"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { switchCompany } from "@/app/actions/auth";
import { landingAfterSwitch } from "@/lib/nav";
import {
  ACTIVE_COOKIE, WORKSPACE_CHANNEL, badgeText, companyInitials, parseWorkspaceKey, workspaceKey,
  type ActiveWorkspace, type WorkspaceAccount,
} from "@/lib/workspace-shared";
import { buttonClass, cn } from "./ui";

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

/** The company's coloured initials: the same mark in the chooser, the console and the tab guard. */
export function CompanyBadge({ name, color, size = 32, className }: { name: string; color: string | null; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-[9px] font-semibold shadow-card", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: color ?? "var(--mark)", color: color ? badgeText(color) : "var(--on-mark)" }}>
      {companyInitials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Switching                                                           */
/* ------------------------------------------------------------------ */

let switching = false;

/** Every company of every signed-in account, in All companies order (Alt+1 … Alt+9). */
export function flatCompanies(accounts: WorkspaceAccount[]) {
  return accounts.flatMap((a) => a.companies.map((c) => ({ ...c, userId: a.userId, email: a.email })));
}

/** Switch this browser to a company and tell the other tabs, so none of them keeps editing the old one. */
export function useSwitchCompany() {
  const path = usePathname();
  return useCallback((userId: string, companyId: string) => {
    switching = true;
    try {
      const ch = new BroadcastChannel(WORKSPACE_CHANNEL);
      ch.postMessage({ key: workspaceKey(userId, companyId) });
      ch.close();
    } catch { /* old browsers: the focus check still catches it */ }
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("companyId", companyId);
    fd.set("path", path);
    startTransition(() => switchCompany(fd));
  }, [path]);
}

/* ------------------------------------------------------------------ */
/* Tab guard                                                           */
/* ------------------------------------------------------------------ */

function readActiveCookie() {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${ACTIVE_COOKIE}=`));
  return m ? decodeURIComponent(m.slice(ACTIVE_COOKIE.length + 1)) : null;
}

/**
 * One browser works in one company at a time. When another tab switches company (or signs out), this tab stops
 * and asks, instead of letting a form written for company A save into company B.
 */
export function WorkspaceGuard({ active, accounts }: { active: ActiveWorkspace; accounts: WorkspaceAccount[] }) {
  const key = workspaceKey(active.userId, active.companyId);
  const [seen, setSeen] = useState<string | null>(null);
  const switchTo = useSwitchCompany();
  const path = usePathname();

  useEffect(() => {
    switching = false;
    const check = () => {
      if (switching) return;
      const now = readActiveCookie();
      setSeen(now === key ? null : (now ?? ""));
    };
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(WORKSPACE_CHANNEL);
      ch.onmessage = (e: MessageEvent<{ key?: string }>) => { if (!switching && e.data?.key && e.data.key !== key) setSeen(e.data.key); };
    } catch { /* focus check only */ }
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => { ch?.close(); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", onVisible); };
  }, [key]);

  if (seen === null) return null;
  const ref = parseWorkspaceKey(seen);
  const other = ref ? flatCompanies(accounts).find((c) => c.userId === ref.userId && c.id === ref.companyId) : undefined;
  const reload = (href: string) => window.location.assign(href);

  return (
    <div className="fade-in fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]" role="alertdialog" aria-modal aria-labelledby="ws-guard-title">
      <div className="pop-in w-full max-w-md rounded-lg border border-line bg-overlay p-5 shadow-float">
        <div className="flex items-center gap-3">
          <CompanyBadge name={active.companyName} color={active.color} size={36} />
          <div className="min-w-0">
            <h2 id="ws-guard-title" className="text-[15px] font-semibold text-fg">{ref ? "You switched company in another tab" : "You signed out in another tab"}</h2>
            <p className="text-[12px] text-fg-subtle">This tab still shows {active.companyName}.</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-fg-muted">
          {ref
            ? <>This browser now works in <span className="font-medium text-fg">{other?.name ?? "another company"}</span>. Choose where to continue so nothing is saved to the wrong company.</>
            : "Sign in again to keep working."}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {ref ? (
            <>
              <button type="button" className={buttonClass("secondary")} onClick={() => { setSeen(null); switchTo(active.userId, active.companyId); }}>
                Back to {active.companyName}
              </button>
              <button type="button" className={buttonClass("primary")} onClick={() => reload(landingAfterSwitch(path))}>
                Continue in {other?.name ?? "the other company"}
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass("primary")} onClick={() => reload("/login")}>Go to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
