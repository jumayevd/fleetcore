import type { Role } from "./constants";

// Single source of truth for who can do what.
export const PERMISSIONS = {
  "dashboard.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT"],
  "loads.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT"],
  "loads.edit": ["OWNER", "ADMIN", "DISPATCHER"],
  "tracking.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER"],
  "fleet.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER"],
  "fleet.edit": ["OWNER", "ADMIN", "FLEET_MANAGER"],
  "drivers.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER"],
  "drivers.edit": ["OWNER", "ADMIN", "FLEET_MANAGER"],
  "customers.view": ["OWNER", "ADMIN", "DISPATCHER", "ACCOUNTANT"],
  "customers.edit": ["OWNER", "ADMIN", "DISPATCHER", "ACCOUNTANT"],
  "finance.view": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "finance.edit": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "reports.view": ["OWNER", "ADMIN", "ACCOUNTANT", "FLEET_MANAGER"],
  "users.manage": ["OWNER", "ADMIN"],
  "audit.view": ["OWNER", "ADMIN"],
  "driver.portal": ["DRIVER"],
  "claims.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT"],
  "claims.edit": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER"],
  "chat.view": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT", "DRIVER"],
  "announcements.manage": ["OWNER", "ADMIN"],
  "company.manage": ["OWNER", "ADMIN"],
  "board.edit": ["OWNER", "ADMIN", "DISPATCHER"],
  "assistant.use": ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

// Which permission a destination needs (mirrors each page's requireUser). Links, alerts and KPI tiles pointing
// somewhere a role cannot open are hidden or re-targeted rather than shown as dead links (requireUser would
// bounce the user straight back). Keep in step with the pages' gates.
const ROUTE_PERMISSIONS: [prefix: string, perm: Permission][] = [
  ["/finance", "finance.view"], ["/claims", "claims.view"], ["/fleet", "fleet.view"], ["/drivers", "drivers.view"],
  ["/customers", "customers.view"], ["/admin", "company.manage"], ["/loads", "loads.view"], ["/dispatch", "loads.view"],
  ["/tracking", "tracking.view"], ["/reports", "reports.view"], ["/maintenance", "fleet.view"],
];

/** Whether `role` can open `href` (unlisted routes are open to every signed-in user). */
export function canOpen(role: string | undefined | null, href: string) {
  const hit = ROUTE_PERMISSIONS.find(([p]) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`) || href.startsWith(`${p}#`));
  return hit ? can(role, hit[1]) : true;
}

export function homeFor(role: string) {
  return role === "DRIVER" ? "/driver" : "/dashboard";
}
