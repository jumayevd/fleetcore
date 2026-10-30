import type { Role } from "./constants";

const EVERYONE = ["OWNER", "ADMIN", "SPECIALIST", "VIEWER"] as const;
const EDITORS = ["OWNER", "ADMIN", "SPECIALIST"] as const;
const ADMINS = ["OWNER", "ADMIN"] as const;

// Single source of truth for who can do what inside a company. Roles are per company (Membership.role).
export const PERMISSIONS = {
  "dashboard.view": EVERYONE,
  "tracking.view": EVERYONE,
  "fleet.view": EVERYONE,
  "fleet.edit": EDITORS,
  "drivers.view": EVERYONE,
  "drivers.edit": EDITORS,
  "reports.view": EVERYONE,
  /** Costs, invoices, spend. View-only members see the work, not the money. */
  "money.view": EDITORS,
  "assistant.use": EVERYONE,
  "company.manage": ADMINS,
  "members.manage": ADMINS,
  "audit.view": ADMINS,
  /** Confirm and close a defect without saying how the repair was checked. Everyone else writes a note. */
  "defects.closeWithoutNote": ADMINS,
  "company.delete": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

// Which permission a destination needs (mirrors each page's requireUser). Links, alerts and KPI tiles pointing
// somewhere a role cannot open are hidden or re-targeted rather than shown as dead links. Keep in step with the pages.
const ROUTE_PERMISSIONS: [prefix: string, perm: Permission][] = [
  ["/fleet", "fleet.view"], ["/maintenance", "fleet.view"], ["/vendors", "fleet.view"], ["/inspections", "fleet.view"],
  ["/drivers", "drivers.view"], ["/tracking", "tracking.view"],
  ["/reports", "reports.view"], ["/admin/members", "members.manage"], ["/admin/audit", "audit.view"], ["/admin", "company.manage"],
];

/** Whether `role` can open `href` (unlisted routes are open to every signed-in member). */
export function canOpen(role: string | undefined | null, href: string) {
  const hit = ROUTE_PERMISSIONS.find(([p]) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`) || href.startsWith(`${p}#`));
  return hit ? can(role, hit[1]) : true;
}

/** Roles `actor` may hand out: only an owner makes owners. */
export function assignableRoles(actor: string): Role[] {
  return actor === "OWNER" ? ["OWNER", "ADMIN", "SPECIALIST", "VIEWER"] : ["ADMIN", "SPECIALIST", "VIEWER"];
}

export const HOME = "/dashboard";
