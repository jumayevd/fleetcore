"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, LayoutGrid, LogOut, Plus, UserPlus } from "lucide-react";
import { signOut, switchCompany } from "@/app/actions/auth";
import { ROLE_LABELS } from "@/lib/constants";
import { landingAfterSwitch } from "@/lib/nav";
import {
  ACTIVE_COOKIE, WORKSPACE_CHANNEL, badgeText, companyInitials, parseWorkspaceKey, workspaceKey,
  type ActiveWorkspace, type WorkspaceAccount,
} from "@/lib/workspace-shared";
import { Kbd, buttonClass, cn } from "./ui";

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

/** The company's coloured initials: the same mark in the switcher, the chooser and the tab guard. */
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

/** Every company of every signed-in account, in switcher order (Alt+1 … Alt+9). */
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
/* Switcher (sidebar header)                                           */
/* ------------------------------------------------------------------ */

export function WorkspaceSwitcher({ active, accounts, expanded }: { active: ActiveWorkspace; accounts: WorkspaceAccount[]; expanded: boolean }) {
  // Where the menu opens (measured on click); null while closed.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;
  const button = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    setPos(open || !r ? null : { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) });
  };
  return (
    <>
      <button ref={button} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open}
        title={expanded ? undefined : `${active.companyName} · ${ROLE_LABELS[active.role]}`}
        className={cn("group flex w-full min-w-0 items-center gap-2.5 rounded-[10px] text-left transition-colors hover:bg-surface/70",
          expanded ? "px-2 py-1.5" : "justify-center py-1.5", open && "bg-surface/70")}>
        <CompanyBadge name={active.companyName} color={active.color} size={30} />
        {expanded && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-4 text-fg">{active.companyName}</span>
              <span className="block truncate text-[11px] leading-4 text-fg-subtle">{ROLE_LABELS[active.role]} · {active.email}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-faint group-hover:text-fg-muted" />
          </>
        )}
      </button>
      {pos && <SwitcherMenu anchor={button} pos={pos} active={active} accounts={accounts} onClose={() => setPos(null)} />}
    </>
  );
}

function SwitcherMenu({ anchor, pos, active, accounts, onClose }: {
  anchor: React.RefObject<HTMLButtonElement | null>; pos: { top: number; left: number }; active: ActiveWorkspace; accounts: WorkspaceAccount[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const switchTo = useSwitchCompany();
  const path = usePathname();
  const flat = flatCompanies(accounts);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} role="menu" aria-label="Switch company" style={{ top: pos.top, left: pos.left }}
      className="pop-in fixed z-[70] w-[288px] overflow-hidden rounded-lg border border-line bg-overlay shadow-float [transform-origin:top_left]">
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <p className="text-[12px] font-semibold text-fg">Companies</p>
        <Link href="/select" onClick={onClose} className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg"><LayoutGrid className="h-3 w-3" />All companies</Link>
      </div>
      <div className="max-h-[min(60vh,420px)] overflow-y-auto pb-1">
        {accounts.map((a) => (
          <div key={a.userId} className="px-1.5 pt-1.5">
            <p className="truncate px-1.5 pb-1 text-[11px] text-fg-subtle" title={a.name}>{a.email}</p>
            {a.companies.length === 0 && <p className="px-1.5 pb-1 text-[12px] text-fg-faint">No companies yet</p>}
            {a.companies.map((c) => {
              const on = a.userId === active.userId && c.id === active.companyId;
              const n = flat.findIndex((f) => f.userId === a.userId && f.id === c.id) + 1;
              return (
                <button key={c.id} type="button" role="menuitemradio" aria-checked={on} aria-label={`${c.name}, ${ROLE_LABELS[c.role]}, ${a.email}`}
                  onClick={() => { onClose(); if (!on) switchTo(a.userId, c.id); }}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-raised", on && "bg-raised")}>
                  <CompanyBadge name={c.name} color={c.color} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{c.name}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">{ROLE_LABELS[c.role]}</span>
                  </span>
                  {on ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : n > 0 && n < 10 && <span className="hidden gap-0.5 sm:flex"><Kbd>Alt</Kbd><Kbd>{n}</Kbd></span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-1">
        <MenuLink href="/select#new" onClick={onClose} icon={<Plus />}>New company</MenuLink>
        <MenuLink href="/login?add=1" onClick={onClose} icon={<UserPlus />}>Add another account</MenuLink>
        <form action={signOut}>
          <input type="hidden" name="userId" value={active.userId} />
          <input type="hidden" name="path" value={path} />
          <button className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-raised hover:text-fg [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0" title={`Sign out of ${active.email}`}>
            <LogOut /><span className="truncate">Sign out of {active.email}</span>
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function MenuLink({ href, onClick, icon, children }: { href: string; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-raised hover:text-fg [&_svg]:h-4 [&_svg]:w-4">
      {icon}{children}
    </Link>
  );
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
