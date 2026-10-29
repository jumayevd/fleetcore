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
    section: "Today",
    icon: "LayoutDashboard",
    items: [
      { href: "/dashboard", label: "Today", icon: "LayoutDashboard", perm: "dashboard.view", shortcut: "g o", description: "What needs a decision today" },
    ],
  },
  {
    section: "Fleet",
    icon: "Truck",
    items: [
      { href: "/fleet", label: "Trucks", icon: "Truck", perm: "fleet.view", shortcut: "g t", description: "Every tractor, PM and paperwork" },
      { href: "/fleet/trailers", label: "Trailers", icon: "Container", perm: "fleet.view", shortcut: "g r", description: "Status, pairing, annual inspection" },
      { href: "/tracking", label: "Live map", icon: "Map", perm: "tracking.view", shortcut: "g m", description: "Where every unit is right now" },
    ],
  },
  {
    section: "Maintenance",
    icon: "Wrench",
    items: [
      { href: "/maintenance/work-orders", label: "Repairs", icon: "ClipboardList", perm: "fleet.view", shortcut: "g w", description: "Repair orders from opening to invoice" },
      { href: "/maintenance/oil", label: "Oil changes", icon: "Droplet", perm: "fleet.view", shortcut: "g s", description: "Oil changes and service by odometer" },
      { href: "/maintenance", label: "Shop overview", icon: "Wrench", perm: "fleet.view", description: "Spend, in shop, lease mileage, compliance" },
      { href: "/vendors", label: "Vendors", icon: "Store", perm: "fleet.view", shortcut: "g v", description: "Shops, dealers, tire and road-side services" },
    ],
  },
  {
    section: "Inspections",
    icon: "ClipboardCheck",
    items: [
      { href: "/inspections", label: "Pre-trip board", icon: "ClipboardCheck", perm: "fleet.view", shortcut: "g i", description: "Weekly walk-around videos and what they showed" },
      { href: "/inspections/defects", label: "Defects", icon: "TriangleAlert", perm: "fleet.view", description: "Everything found wrong, until it is fixed and confirmed" },
      { href: "/inspections/roadside", label: "DOT inspections", icon: "ShieldAlert", perm: "fleet.view", description: "DOT inspections at the roadside, violations and corrections" },
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
      { href: "/admin/company", label: "Company profile", icon: "Landmark", perm: "company.manage", shortcut: "g c", description: "Name, units, time zone, documents" },
      { href: "/admin/members", label: "Members", icon: "ShieldCheck", perm: "members.manage", description: "Who works in this company and their role" },
      { href: "/admin/integrations", label: "Integrations", icon: "Plug", perm: "company.manage", description: "TrackPro ELD: live positions, fuel, drivers" },
      { href: "/admin/audit", label: "Audit log", icon: "ScrollText", perm: "audit.view" },
    ],
  },
];

/** Breadcrumb titles for route segments that aren't nav items. */
export const SEGMENT_LABELS: Record<string, string> = {
  new: "New", edit: "Edit", "work-orders": "Repairs", trailers: "Trailers", account: "My account", admin: "Company",
  company: "Company profile", members: "Members", audit: "Audit log", integrations: "Integrations", alerts: "Needs attention", oil: "Oil changes",
  defects: "Defects", roadside: "DOT inspections", vendors: "Vendors", inspections: "Pre-trip board",
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
