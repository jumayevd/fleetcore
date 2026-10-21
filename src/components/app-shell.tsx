"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Map, Truck, Container, Wrench, ClipboardList, Users, BarChart3, Landmark, ShieldCheck, ScrollText, Settings,
  Droplet, Store, ClipboardCheck, TriangleAlert, ShieldAlert,
  Bell, Search, Menu, X, LogOut, UserCircle, PanelLeftClose, PanelLeftOpen, ChevronRight, Palette, Package, UserPlus, LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { cn, Avatar, Kbd, StatusDot } from "./ui";
// Opened on demand, so they download on first use instead of with every page.
const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), { ssr: false });
const AppearanceControls = dynamic(() => import("./appearance").then((m) => m.AppearanceControls), {
  ssr: false,
  loading: () => <div className="h-72" aria-busy="true" />,
});
import { NavProgress } from "./nav-progress";
import { LocaleProvider } from "./locale";
import { CompanyClock } from "./company-clock";
import { WorkspaceGuard, WorkspaceSwitcher, flatCompanies, useSwitchCompany } from "./workspace-switcher";
import { NAV, NAV_COOKIE, SEGMENT_LABELS, allNavItems, findNavItem, findNavSection } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/constants";
import { signOut, signOutAll } from "@/app/actions/auth";
import type { ActiveWorkspace, WorkspaceAccount } from "@/lib/workspace-shared";
import type { Alert } from "@/lib/alerts";
import type { CompanyLocale } from "@/lib/locale";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Map, Truck, Container, Wrench, ClipboardList, Users, BarChart3, Landmark, ShieldCheck, ScrollText, Settings,
  Droplet, Store, ClipboardCheck, TriangleAlert, ShieldAlert,
};

type ShellUser = { name: string; email: string; role: ActiveWorkspace["role"] };

/** Alerts for the bell and counts for the nav (GET /api/shell). */
export type ShellData = { alerts: Alert[]; badges: Record<string, number> };

/**
 * Bell alerts and nav counts, fetched by the browser after the page has rendered and again on every navigation and
 * once a minute. Not streamed from the layout: a promise handed from the layout to the shell races a page that calls
 * notFound() (React then throws "boundaries should not be flushed again" and the request can hang).
 */
function useShellData(path: string): ShellData | null {
  const [data, setData] = useState<ShellData | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/shell", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ShellData>) : null))
      .then((d) => { if (live && d) setData(d); })
      .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [path]);
  return data;
}

export function AppShell({ user, active, accounts, locale, navOpen, children }: {
  user: ShellUser;
  /** The active company's units, time zone and currency (useFormat() in client components). */
  locale: CompanyLocale;
  /** The company this browser is working in, and as which signed-in account. */
  active: ActiveWorkspace;
  /** Every signed-in account with its companies (the switcher). */
  accounts: WorkspaceAccount[];
  /** Sidebar state from the cookie, so the first paint already has the right width. */
  navOpen: boolean;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const data = useShellData(path);
  const [pinned, setPinned] = useState(navOpen);
  const [cmd, setCmd] = useState(false);
  const chord = useRef<string | null>(null);
  const switchTo = useSwitchCompany();
  const setSidebar = (open: boolean) => {
    setPinned(open);
    document.cookie = `${NAV_COOKIE}=${open ? "open" : "rail"}; path=/; max-age=31536000; samesite=lax`;
  };
  const togglePinned = () => setSidebar(!pinned);

  // Global keys: ⌘K / Ctrl+K or "/" opens search; "g" then a letter jumps (g t → trucks); Alt+1…9 switches company.
  useEffect(() => {
    const shortcuts = Object.fromEntries(allNavItems().filter((i) => i.shortcut && can(user.role, i.perm)).map((i) => [i.shortcut!.split(" ")[1], i.href]));
    const companies = flatCompanies(accounts);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((c) => !c); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        const c = companies[Number(e.code.slice(5)) - 1];
        if (c) {
          e.preventDefault();
          if (c.userId !== active.userId || c.id !== active.companyId) switchTo(c.userId, c.id);
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setCmd(true); return; }
      if (chord.current === "g") {
        chord.current = null;
        const href = shortcuts[e.key.toLowerCase()];
        if (href) { e.preventDefault(); router.push(href); }
        return;
      }
      if (e.key === "g") { chord.current = "g"; setTimeout(() => { chord.current = null; }, 1200); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, user.role, accounts, active.userId, active.companyId, switchTo]);

  return (
    <div className="min-h-screen">
      <Suspense fallback={null}><NavProgress /></Suspense>
      {/* Desktop sidebar: labelled by default; collapses to a 64px rail that expands on hover. */}
      <aside className={cn("group/rail fixed inset-y-0 left-0 z-40 hidden bg-canvas transition-[width,box-shadow] duration-200 ease-out lg:block print:hidden",
        pinned ? "w-60" : "w-16 border-r border-line hover:w-60 hover:shadow-float")}>
        <div className={cn(pinned ? "block" : "hidden group-hover/rail:block", "h-full")}>
          <SideNav user={user} active={active} accounts={accounts} path={path} data={data} expanded pinned={pinned} onTogglePin={togglePinned} />
        </div>
        {!pinned && (
          <div className="h-full group-hover/rail:hidden">
            <SideNav user={user} active={active} accounts={accounts} path={path} data={data} expanded={false} pinned={pinned} onTogglePin={togglePinned} />
          </div>
        )}
      </aside>

      <div className={cn("transition-[padding] duration-200 ease-out", pinned ? "lg:pl-60" : "lg:pl-16", "print:pl-0")}>
        {/* Keyed by path so popovers and the mobile drawer close on navigation without effects. */}
        <TopBar key={path} user={user} active={active} accounts={accounts} locale={locale} path={path} data={data} pinned={pinned} onSidebar={setSidebar} openSearch={() => setCmd(true)} />
        <main className="mx-auto w-full max-w-[1680px] px-4 pb-8 pt-2 lg:px-6"><LocaleProvider locale={locale}>{children}</LocaleProvider></main>
      </div>
      {cmd && <CommandPalette onClose={() => setCmd(false)} role={user.role} active={active} accounts={accounts} onSwitch={switchTo} />}
      <WorkspaceGuard active={active} accounts={accounts} />
    </div>
  );
}

function SideNav({ user, active, accounts, path, data, expanded, pinned, onTogglePin, onNavigate }: {
  user: ShellUser; active: ActiveWorkspace; accounts: WorkspaceAccount[]; path: string; data: ShellData | null;
  expanded: boolean; pinned: boolean; onTogglePin: () => void; onNavigate?: () => void;
}) {
  const activeHref = findNavItem(path)?.href;
  const activeSection = findNavSection(path)?.section;
  // Categories fold: the one you are in opens by itself; others open on click and stay as you left them.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(user.role, i.perm)) })).filter((g) => g.items.length);
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      {/* The company's colour along the top edge: you always see which company you are working in. */}
      <div aria-hidden className="h-[3px] shrink-0" style={{ background: active.color ?? "var(--mark)" }} />
      <div className={cn("flex h-14 shrink-0 items-center", expanded ? "px-2" : "justify-center px-1.5")}>
        <WorkspaceSwitcher active={active} accounts={accounts} expanded={expanded} />
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 pb-3 pt-1">
        {groups.map((g) => {
          const here = g.section === activeSection;
          const single = g.items.length === 1;
          // One item in the category, or the icon rail: a plain link, no fold.
          if (single || !expanded) {
            const item = single ? g.items[0] : (g.items.find((i) => i.href === activeHref) ?? g.items[0]);
            const Icon = ICONS[single ? item.icon : g.icon] ?? Package;
            const label = single ? item.label : g.section;
            return (
              <Link key={g.section} href={item.href} title={expanded ? undefined : label} onClick={onNavigate} aria-current={here && single ? "page" : undefined}
                className={cn("group relative flex h-9 items-center gap-2.5 rounded-[9px] text-[13px] font-medium transition-[color,background-color,box-shadow] duration-150",
                  expanded ? "px-2.5" : "justify-center",
                  here ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:bg-surface/60 hover:text-fg")}>
                <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", here ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")} />
                {expanded && <span className="truncate">{label}</span>}
                <Suspense fallback={null}><NavBadge data={data} hrefs={g.items.map((i) => i.href)} expanded={expanded} /></Suspense>
              </Link>
            );
          }
          const open = toggled[g.section] ?? here;
          const Icon = ICONS[g.icon] ?? Package;
          return (
            <div key={g.section}>
              <button type="button" aria-expanded={open} onClick={() => setToggled((t) => ({ ...t, [g.section]: !open }))}
                className={cn("group flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors duration-150",
                  here ? "text-fg" : "text-fg-muted hover:bg-surface/60 hover:text-fg")}>
                <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", here ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")} />
                <span className="flex-1 truncate text-left">{g.section}</span>
                {!open && <Suspense fallback={null}><NavBadge data={data} hrefs={g.items.map((i) => i.href)} expanded /></Suspense>}
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform duration-200", open && "rotate-90")} />
              </button>
              <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="min-h-0 overflow-hidden" inert={!open}>
                  <ul className="ml-[19px] space-y-0.5 border-l border-line py-1 pl-2">
                    {g.items.map((i) => {
                      const on = activeHref === i.href;
                      return (
                        <li key={i.href} className="relative">
                          {on && <span aria-hidden className="absolute -left-[9px] bottom-2 top-2 w-[2px] rounded-full bg-accent" />}
                          <Link href={i.href} onClick={onNavigate} aria-current={on ? "page" : undefined}
                            className={cn("group flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-[13px] transition-[color,background-color,box-shadow] duration-150",
                              on ? "bg-surface font-medium text-fg shadow-card" : "text-fg-muted hover:bg-surface/60 hover:text-fg")}>
                            <span className="truncate">{i.label}</span>
                            <Suspense fallback={null}><NavBadge data={data} hrefs={[i.href]} expanded /></Suspense>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 p-2">
        <Link href="/select" onClick={onNavigate} title="FleetCore · all companies"
          className={cn("flex h-8 min-w-0 items-center gap-2 rounded-[9px] text-[12px] text-fg-subtle transition-colors hover:bg-surface/60 hover:text-fg", expanded ? "flex-1 px-2.5" : "w-full justify-center")}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-mark text-on-mark"><Truck className="h-3 w-3" /></span>
          {expanded && <span className="truncate font-medium">FleetCore</span>}
        </Link>
        {expanded && (
          <button type="button" onClick={onTogglePin} title={pinned ? "Collapse sidebar" : "Keep sidebar open"}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-fg-subtle transition-colors hover:bg-surface/60 hover:text-fg lg:flex">
            {pinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
        )}
      </div>
    </nav>
  );
}

/** Count chip on a nav item or a folded category (overdue work orders). */
function NavBadge({ data, hrefs, expanded }: { data: ShellData | null; hrefs: string[]; expanded: boolean }) {
  const badges = data?.badges ?? {};
  const n = hrefs.reduce((a, h) => a + (badges[h] ?? 0), 0);
  if (!n) return null;
  return expanded
    ? <span className="num fade-in ml-auto rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold leading-[18px] text-accent-text">{n}</span>
    : <span className="fade-in absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />;
}

function TopBar({ user, active, accounts, locale, path, data, pinned, onSidebar, openSearch }: {
  user: ShellUser; active: ActiveWorkspace; accounts: WorkspaceAccount[]; locale: CompanyLocale; path: string; data: ShellData | null;
  pinned: boolean; onSidebar: (open: boolean) => void; openSearch: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [look, setLook] = useState(false);
  const only = (which: "bell" | "user" | "look") => { setBell(which === "bell" ? (b) => !b : false); setUserMenu(which === "user" ? (u) => !u : false); setLook(which === "look" ? (l) => !l : false); };
  const crumbs = breadcrumbs(path);
  const many = accounts.length > 1;

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fade-in absolute inset-0 bg-scrim" onClick={() => setMobileOpen(false)} />
          <aside className="drawer-in absolute inset-y-0 left-0 w-64 border-r border-line bg-canvas shadow-float">
            <SideNav user={user} active={active} accounts={accounts} path={path} data={data} expanded pinned={pinned} onTogglePin={() => {}} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-canvas/80 px-3 backdrop-blur-md print:hidden lg:px-6">
        <button className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-raised lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
          {/* On a phone the sidebar is hidden, so the company leads the breadcrumb. */}
          <span className="flex min-w-0 items-center gap-1 lg:hidden">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: active.color ?? "var(--mark)" }} aria-hidden />
            <span className="max-w-28 truncate font-medium text-fg-muted">{active.companyName}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
          </span>
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
              {i === crumbs.length - 1
                ? <span className="truncate font-medium text-fg">{c.label}</span>
                : <Link href={c.href} className="truncate text-fg-muted transition-colors hover:text-fg">{c.label}</Link>}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-2"><CompanyClock locale={locale} /></div>
          <button onClick={openSearch} className="hidden h-9 w-64 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-fg-subtle shadow-card transition-colors hover:border-line-strong hover:text-fg-muted sm:flex" aria-label="Search">
            <Search className="h-3.5 w-3.5" /><span className="flex-1 truncate text-left">Search {active.companyName}…</span><Kbd>⌘K</Kbd>
          </button>
          <button onClick={openSearch} className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-raised sm:hidden" aria-label="Search"><Search className="h-4 w-4" /></button>
          <div className="relative">
            <button onClick={() => only("look")} className={cn("rounded-md p-1.5 text-fg-muted transition-colors hover:bg-raised hover:text-fg", look && "bg-raised text-fg")}
              aria-label="Appearance" aria-expanded={look} title="Appearance">
              <Palette className="h-4 w-4" />
            </button>
            {look && (
              <Popover onClose={() => setLook(false)} className="w-80">
                <div className="px-4 pb-1 pt-3">
                  <p className="text-[13px] font-semibold text-fg">Appearance</p>
                  <p className="text-[12px] text-fg-subtle">Saved in this browser</p>
                </div>
                <div className="px-4 pb-4 pt-3"><AppearanceControls sidebarOpen={pinned} onSidebar={onSidebar} /></div>
              </Popover>
            )}
          </div>
          <div className="relative">
            <Suspense fallback={<BellButton count={0} critical={0} onClick={() => {}} />}>
              <BellMenu data={data} open={bell} onToggle={() => only("bell")} onClose={() => setBell(false)} />
            </Suspense>
          </div>
          <div className="relative">
            <button onClick={() => only("user")} className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-raised" aria-label="Account menu">
              <Avatar name={user.name} size={26} />
              <span className="hidden text-[13px] font-medium text-fg-muted md:block">{user.name.split(" ")[0]}</span>
            </button>
            {userMenu && (
              <Popover onClose={() => setUserMenu(false)} className="w-64">
                <div className="px-3 py-2.5">
                  <p className="truncate text-[13px] font-medium text-fg">{user.name}</p>
                  <p className="truncate text-[12px] text-fg-subtle">{user.email}</p>
                  <p className="mt-1 truncate text-[12px] text-fg-muted">{ROLE_LABELS[user.role]} in {active.companyName}</p>
                </div>
                <div className="border-t border-line p-1">
                  <MenuLink href="/account" icon={<UserCircle />}>My account</MenuLink>
                  <MenuLink href="/select" icon={<LayoutGrid />}>All companies</MenuLink>
                  <MenuLink href="/login?add=1" icon={<UserPlus />}>Add another account</MenuLink>
                </div>
                <div className="border-t border-line p-1">
                  <form action={signOut}>
                    <input type="hidden" name="userId" value={active.userId} />
                    <input type="hidden" name="path" value={path} />
                    <button className={menuItem}><LogOut />{many ? `Sign out of ${user.email}` : "Sign out"}</button>
                  </form>
                  {many && <form action={signOutAll}><button className={menuItem}><LogOut />Sign out of all accounts</button></form>}
                </div>
              </Popover>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

const menuItem = "flex w-full min-w-0 items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-raised hover:text-fg [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

function MenuLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return <Link href={href} className={menuItem}>{icon}{children}</Link>;
}

function BellButton({ count, critical, onClick }: { count: number; critical: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative rounded-md p-1.5 text-fg-muted transition-colors hover:bg-raised hover:text-fg" aria-label={`Alerts (${count})`}>
      <Bell className="h-4 w-4" />
      {count > 0 && <span className={cn("fade-in absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-canvas", critical ? "bg-danger" : "bg-warn")} />}
    </button>
  );
}

function BellMenu({ data, open, onToggle, onClose }: { data: ShellData | null; open: boolean; onToggle: () => void; onClose: () => void }) {
  const alerts = data?.alerts ?? [];
  const critical = alerts.filter((a) => a.level === "critical").length;
  return (
    <>
      <BellButton count={alerts.length} critical={critical} onClick={onToggle} />
      {open && (
        <Popover onClose={onClose} className="w-80">
          <div className="flex items-center justify-between px-3 py-2.5">
            <p className="text-[13px] font-semibold text-fg">Needs attention</p>
            <span className="num text-[12px] text-fg-subtle">{critical ? <span className="text-danger">{critical} critical · </span> : null}{alerts.length} open</span>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto border-t border-line py-1">
            {alerts.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-fg-subtle">All clear</li>}
            {alerts.slice(0, 30).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex gap-2.5 px-3 py-2 transition-colors hover:bg-raised">
                  <StatusDot tone={a.level === "critical" ? "danger" : "warn"} className="mt-1.5" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg">{a.title}</span>
                    <span className="block truncate text-[12px] text-fg-subtle">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {alerts.length > 0 && (
            <Link href="/dashboard/alerts" className="block border-t border-line px-3 py-2 text-[12px] font-medium text-fg-muted transition-colors hover:bg-raised hover:text-fg">View all →</Link>
          )}
        </Popover>
      )}
    </>
  );
}

function Popover({ children, onClose, className }: { children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return <div ref={ref} className={cn("pop-in absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-line bg-overlay shadow-float", className)}>{children}</div>;
}

function breadcrumbs(path: string): { href: string; label: string }[] {
  const item = findNavItem(path);
  const out: { href: string; label: string }[] = [];
  if (item) out.push({ href: item.href, label: item.label });
  const base = item?.href ?? "";
  const rest = path.slice(base.length).split("/").filter(Boolean);
  let acc = base;
  for (const seg of rest) {
    acc += `/${seg}`;
    const label = SEGMENT_LABELS[seg] ?? (seg.length > 16 ? "Details" : seg[0].toUpperCase() + seg.slice(1));
    out.push({ href: acc, label });
  }
  if (!out.length) out.push({ href: path, label: SEGMENT_LABELS[rest[0]] ?? "FleetCore" });
  return out;
}
