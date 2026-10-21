import type { Permission } from "./permissions";

/**
 * Information architecture. Shared by the sidebar, breadcrumbs and the command palette.
 * Keep routes here even before their page exists so the shell stays the single source of truth.
 */
export type NavItem = { href: string; label: string; icon: string; perm: Permission; shortcut?: string; description?: string };
/** A sidebar category. It folds open on click; a category with one item shows as a plain link. */
export type NavSection = { section: string; icon: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    section: "Overview",
    icon: "LayoutDashboard",
    items: [
      { href: "/dashboard", label: "Overview", icon: "LayoutDashboard", perm: "dashboard.view", shortcut: "g o", description: "What needs you today, fleet at a glance" },
    ],
  },
  {
    section: "Fleet",
    icon: "Truck",
    items: [
      { href: "/fleet", label: "Trucks", icon: "Truck", perm: "fleet.view", shortcut: "g t", description: "Every tractor, PM and paperwork" },
      { href: "/fleet/trailers", label: "Trailers", icon: "Container", perm: "fleet.view", shortcut: "g r", description: "Status, pairing, location" },
      { href: "/tracking", label: "Live map", icon: "Map", perm: "tracking.view", shortcut: "g m", description: "Where every unit is right now" },
    ],
  },
  {
    section: "Maintenance",
    icon: "Wrench",
    items: [
      { href: "/maintenance", label: "Maintenance", icon: "Wrench", perm: "fleet.view", shortcut: "g s", description: "Spend, PM schedule, in shop, compliance" },
      { href: "/maintenance/work-orders", label: "Work orders", icon: "ClipboardList", perm: "fleet.view", shortcut: "g w", description: "Repairs, PM and inspections" },
    ],
  },
  {
    section: "Drivers",
    icon: "Users",
    items: [
      { href: "/drivers", label: "Drivers", icon: "Users", perm: "drivers.view", shortcut: "g d", description: "Licences, medicals, assignments" },
    ],
  },
  {
    section: "Reports",
    icon: "BarChart3",
    items: [
      { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports.view", shortcut: "g p", description: "Maintenance, fuel and fleet costs" },
    ],
  },
  {
    section: "Settings",
    icon: "Settings",
    items: [
      { href: "/admin/company", label: "Company profile", icon: "Landmark", perm: "company.manage", shortcut: "g c" },
      { href: "/admin/members", label: "Members", icon: "ShieldCheck", perm: "members.manage", description: "Who works in this company and their role" },
      { href: "/admin/audit", label: "Audit log", icon: "ScrollText", perm: "audit.view" },
    ],
  },
];

/** Breadcrumb titles for route segments that aren't nav items. */
export const SEGMENT_LABELS: Record<string, string> = {
  new: "New", edit: "Edit", "work-orders": "Work orders", trailers: "Trailers", account: "My account", admin: "Company",
  company: "Company profile", members: "Members", audit: "Audit log", alerts: "Needs attention",
};

export function allNavItems() {
  return NAV.flatMap((s) => s.items);
}

export function findNavSection(path: string) {
  const item = findNavItem(path);
  return item ? NAV.find((s) => s.items.includes(item)) : undefined;
}

export function findNavItem(path: string) {
  // Longest matching href wins (so /fleet/trailers beats /fleet).
  return allNavItems()
    .filter((i) => path === i.href || path.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * Where to land after switching company from `path`: the same list page (Trucks stays Trucks), never a record of the
 * company you just left. Personal pages stay put.
 */
export function landingAfterSwitch(path: string | null | undefined) {
  if (!path) return "/dashboard";
  if (path === "/account") return path;
  return findNavItem(path)?.href ?? "/dashboard";
}

/** Sidebar state cookie: "open" (labelled sidebar, the default) or "rail" (icons only, expands on hover). */
export const NAV_COOKIE = "nav";
