import type { Permission } from "./permissions";

/**
 * Information architecture. Shared by the sidebar, breadcrumbs and the command palette.
 * Keep routes here even before their page exists so the shell stays the single source of truth.
 */
export type NavItem = { href: string; label: string; icon: string; perm: Permission; shortcut?: string; description?: string };
/** A sidebar category. It folds open on click; a category with one item for this role shows as a plain link. */
export type NavSection = { section: string; icon: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    section: "Overview",
    icon: "LayoutDashboard",
    items: [
      { href: "/dashboard", label: "Overview", icon: "LayoutDashboard", perm: "dashboard.view", shortcut: "g o", description: "KPIs, exceptions, live fleet" },
    ],
  },
  {
    section: "Dispatch",
    icon: "Rows3",
    items: [
      { href: "/dispatch", label: "Board", icon: "Rows3", perm: "loads.view", shortcut: "g b", description: "Daily dispatch board by team" },
      { href: "/loads", label: "Loads", icon: "Package", perm: "loads.view", shortcut: "g l", description: "All shipments" },
      { href: "/tracking", label: "Live map", icon: "Map", perm: "tracking.view", shortcut: "g m", description: "Every truck, route and ETA" },
      { href: "/dispatch/weekly", label: "Weekly", icon: "CalendarRange", perm: "loads.view", shortcut: "g w", description: "Production per driver per day" },
      { href: "/driver", label: "My trips", icon: "Navigation", perm: "driver.portal", description: "Driver portal" },
    ],
  },
  {
    section: "Fleet",
    icon: "Truck",
    items: [
      { href: "/fleet", label: "Trucks", icon: "Truck", perm: "fleet.view", shortcut: "g t" },
      { href: "/fleet/trailers", label: "Trailers", icon: "Container", perm: "fleet.view" },
      { href: "/maintenance", label: "Maintenance", icon: "Wrench", perm: "fleet.view", description: "Spend, PM schedule, in shop" },
      { href: "/maintenance/work-orders", label: "Work orders", icon: "ClipboardList", perm: "fleet.view" },
    ],
  },
  {
    section: "People",
    icon: "Users",
    items: [
      { href: "/drivers", label: "Drivers", icon: "Users", perm: "drivers.view", shortcut: "g d" },
      { href: "/customers", label: "Customers & brokers", icon: "Building2", perm: "customers.view", shortcut: "g c" },
    ],
  },
  {
    section: "Money",
    icon: "Wallet",
    items: [
      { href: "/finance", label: "Finance", icon: "Receipt", perm: "finance.view", shortcut: "g f", description: "Invoices, receivables, billing queue" },
      { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports.view", shortcut: "g r" },
      { href: "/claims", label: "Claims", icon: "ShieldAlert", perm: "claims.view" },
    ],
  },
  {
    section: "Team",
    icon: "MessageSquare",
    items: [
      { href: "/chat", label: "Chat", icon: "MessageSquare", perm: "chat.view", description: "Company room and load threads" },
      { href: "/announcements", label: "Announcements", icon: "Megaphone", perm: "chat.view" },
    ],
  },
  {
    section: "Settings",
    icon: "Settings",
    items: [
      { href: "/admin/company", label: "Company profile", icon: "Landmark", perm: "company.manage" },
      { href: "/admin/users", label: "Users & roles", icon: "ShieldCheck", perm: "users.manage" },
      { href: "/admin/telegram", label: "Telegram alerts", icon: "Send", perm: "users.manage" },
      { href: "/admin/audit", label: "Audit log", icon: "ScrollText", perm: "audit.view" },
    ],
  },
];

/** Breadcrumb titles for route segments that aren't nav items. */
export const SEGMENT_LABELS: Record<string, string> = {
  new: "New", edit: "Edit", invoices: "Invoices", "work-orders": "Work orders", trailers: "Trailers",
  weekly: "Weekly", prebook: "Prebook", account: "My account", admin: "Company", company: "Company profile",
  users: "Users & roles", telegram: "Telegram alerts", audit: "Audit log", dispatch: "Dispatch",
};

export function allNavItems() {
  return NAV.flatMap((s) => s.items);
}

export function findNavSection(path: string) {
  const item = findNavItem(path);
  return item ? NAV.find((s) => s.items.includes(item)) : undefined;
}

export function findNavItem(path: string) {
  // Longest matching href wins (so /dispatch/weekly beats /dispatch).
  return allNavItems()
    .filter((i) => path === i.href || path.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Sidebar state cookie: "open" (labelled sidebar, the default) or "rail" (icons only, expands on hover). */
export const NAV_COOKIE = "nav";
