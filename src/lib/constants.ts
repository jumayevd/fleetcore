/* ------------------------------------------------------------------ */
/* Company roles                                                       */
/* ------------------------------------------------------------------ */

/** A person's role inside one company (Membership.role). The same person can hold a different role elsewhere. */
export const ROLES = ["OWNER", "ADMIN", "SPECIALIST", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  SPECIALIST: "Fleet specialist",
  VIEWER: "View only",
};

export const ROLE_HINTS: Record<Role, string> = {
  OWNER: "Everything, including members, owners and deleting the company",
  ADMIN: "Everything except owner accounts and deleting the company",
  SPECIALIST: "Trucks, trailers, maintenance, drivers and documents",
  VIEWER: "Sees everything, changes nothing",
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** Workspace badge colours (stored as data on Company.color). */
export const COMPANY_COLORS = ["#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#0D9488", "#475569"] as const;

/* ------------------------------------------------------------------ */
/* Fleet                                                               */
/* ------------------------------------------------------------------ */

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
/** Trailer body types. */
export const EQUIPMENT = ["DRY_VAN", "REEFER", "FLATBED", "TANKER", "CONTAINER"] as const;
export const EQUIPMENT_LABELS: Record<string, string> = {
  DRY_VAN: "Dry van",
  REEFER: "Reefer",
  FLATBED: "Flatbed",
  TANKER: "Tanker",
  CONTAINER: "Container",
};

export const TRUCK_STATUSES = ["ACTIVE", "MAINTENANCE", "OUT_OF_SERVICE", "INACTIVE"] as const;
export const OWNERSHIP = ["COMPANY", "OWNER_OPERATOR", "LEASED"] as const;
export const OWNERSHIP_LABELS: Record<string, string> = { COMPANY: "Company", OWNER_OPERATOR: "Owner-operator", LEASED: "Leased" };

export const TRAILER_STATUSES = ["IN_USE", "EMPTY", "DROPPED", "YARD", "SHOP", "OUT_OF_SERVICE"] as const;
export const TRAILER_STATUS_LABELS: Record<string, string> = {
  IN_USE: "In use", EMPTY: "Empty", DROPPED: "Dropped", YARD: "Yard", SHOP: "Shop", OUT_OF_SERVICE: "Out of service",
};

export const WORK_ORDER_CATEGORIES = ["PM", "ENGINE", "COOLING", "TIRES", "BRAKES", "ELECTRICAL", "BODY", "TOWING", "INSPECTION", "OTHER"] as const;
export const WORK_ORDER_CATEGORY_LABELS: Record<string, string> = {
  PM: "PM service", ENGINE: "Engine & drivetrain", COOLING: "Cooling", TIRES: "Tires & wheels", BRAKES: "Brakes",
  ELECTRICAL: "Electrical", BODY: "Body / accident", TOWING: "Towing", INSPECTION: "Inspection", OTHER: "Other",
};
export const WORK_ORDER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const WORK_ORDER_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

/* ------------------------------------------------------------------ */
/* Drivers                                                             */
/* ------------------------------------------------------------------ */

/** Employment status. */
export const DRIVER_STATUSES = ["ACTIVE", "ON_LEAVE", "INACTIVE"] as const;
export const DRIVER_TYPES = ["COMPANY", "OWNER_OPERATOR", "LEASE"] as const;
export const DRIVER_TYPE_LABELS: Record<string, string> = { COMPANY: "Company", OWNER_OPERATOR: "Owner-operator", LEASE: "Lease-operator" };
export const DRIVER_TYPE_SHORT: Record<string, string> = { COMPANY: "C", OWNER_OPERATOR: "OO", LEASE: "LO" };

/* ------------------------------------------------------------------ */
/* Helpers & geography                                                 */
/* ------------------------------------------------------------------ */

export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const TIMEZONE = "Asia/Tashkent";

// Known depots / cities used for quick location entry and demo data.
export const CITIES: { name: string; country: string; lat: number; lng: number }[] = [
  { name: "Tashkent", country: "UZ", lat: 41.2995, lng: 69.2401 },
  { name: "Samarkand", country: "UZ", lat: 39.6542, lng: 66.9597 },
  { name: "Bukhara", country: "UZ", lat: 39.7747, lng: 64.4286 },
  { name: "Navoi", country: "UZ", lat: 40.0844, lng: 65.3792 },
  { name: "Karshi", country: "UZ", lat: 38.8606, lng: 65.7891 },
  { name: "Termez", country: "UZ", lat: 37.2242, lng: 67.2783 },
  { name: "Jizzakh", country: "UZ", lat: 40.1158, lng: 67.8422 },
  { name: "Andijan", country: "UZ", lat: 40.7821, lng: 72.3442 },
  { name: "Namangan", country: "UZ", lat: 40.9983, lng: 71.6726 },
  { name: "Fergana", country: "UZ", lat: 40.3894, lng: 71.7864 },
  { name: "Kokand", country: "UZ", lat: 40.5286, lng: 70.9425 },
  { name: "Urgench", country: "UZ", lat: 41.55, lng: 60.6333 },
  { name: "Nukus", country: "UZ", lat: 42.4611, lng: 59.6003 },
  { name: "Almaty", country: "KZ", lat: 43.2389, lng: 76.8897 },
  { name: "Shymkent", country: "KZ", lat: 42.3417, lng: 69.5901 },
  { name: "Bishkek", country: "KG", lat: 42.8746, lng: 74.5698 },
  { name: "Osh", country: "KG", lat: 40.5283, lng: 72.7985 },
  { name: "Dushanbe", country: "TJ", lat: 38.5598, lng: 68.787 },
  { name: "Khujand", country: "TJ", lat: 40.2826, lng: 69.6222 },
  { name: "Ashgabat", country: "TM", lat: 37.9601, lng: 58.3261 },
];

/** Nearest known city for a coordinate — used for "last seen near …" labels. */
export function nearestCity(lat: number, lng: number) {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + ((c.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  const km = Math.sqrt(bestD) * 111;
  return { city: best, km: Math.round(km), label: km < 15 ? best.name : `${Math.round(km)} km from ${best.name}` };
}
