export const ROLES = ["OWNER", "ADMIN", "DISPATCHER", "FLEET_MANAGER", "ACCOUNTANT", "DRIVER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  DISPATCHER: "Dispatcher",
  FLEET_MANAGER: "Fleet manager",
  ACCOUNTANT: "Accountant",
  DRIVER: "Driver",
};

/* ------------------------------------------------------------------ */
/* Loads                                                               */
/* ------------------------------------------------------------------ */

export const LOAD_STATUSES = ["PLANNED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "INVOICED", "CANCELLED", "TONU"] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  PLANNED: "Booked",
  ASSIGNED: "Dispatched",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
  TONU: "TONU",
};

/** Allowed next statuses from each status (the dispatch workflow). TONU = truck ordered, not used. */
export const LOAD_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  PLANNED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_TRANSIT", "PLANNED", "CANCELLED", "TONU"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: ["INVOICED"],
  INVOICED: [],
  CANCELLED: ["PLANNED"],
  TONU: ["INVOICED"],
};

export const BILLING_STAGES = ["NONE", "MISSING_DOCS", "READY_TO_INVOICE", "INVOICED", "PAID"] as const;
export type BillingStage = (typeof BILLING_STAGES)[number];
export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  NONE: "—", MISSING_DOCS: "Missing docs", READY_TO_INVOICE: "Ready to invoice", INVOICED: "Invoiced", PAID: "Paid",
};

/** Documents a load needs before it can be billed. */
export const REQUIRED_LOAD_DOCS = ["RC", "POD"] as const;
/** Billing paperwork by load status: a TONU (truck ordered, not used) was never delivered, so only the RC applies. */
export const requiredDocsFor = (status: string): readonly string[] => (status === "TONU" ? ["RC"] : REQUIRED_LOAD_DOCS);

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const EQUIPMENT = ["DRY_VAN", "REEFER", "FLATBED", "TANKER", "CONTAINER"] as const;
export const EQUIPMENT_LABELS: Record<string, string> = {
  DRY_VAN: "Dry van",
  REEFER: "Reefer",
  FLATBED: "Flatbed",
  TANKER: "Tanker",
  CONTAINER: "Container",
};


export const CUSTOMER_KINDS = ["SHIPPER", "BROKER", "BOTH"] as const;
export const CUSTOMER_KIND_LABELS: Record<string, string> = { SHIPPER: "Shipper", BROKER: "Broker", BOTH: "Shipper & broker" };

/* ------------------------------------------------------------------ */
/* Fleet                                                               */
/* ------------------------------------------------------------------ */

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

/** Dispatch-board state. The first five are derived automatically from the driver's load. */
export const BOARD_STATUSES = ["READY", "DISPATCHED", "AT_PICKUP", "EN_ROUTE", "UNLOADING", "STOP", "REST", "HOME", "VACATION"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  READY: "Ready", DISPATCHED: "Dispatched", AT_PICKUP: "At pickup", EN_ROUTE: "En route", UNLOADING: "Unloading",
  STOP: "Stopped", REST: "Rest", HOME: "Home", VACATION: "Vacation",
};
/** Statuses a dispatcher sets by hand (the rest are computed from loads). */
export const MANUAL_BOARD_STATUSES: BoardStatus[] = ["STOP", "REST", "HOME", "VACATION", "READY"];
/** Order used by the "flat" board view. */
export const BOARD_STATUS_ORDER: BoardStatus[] = ["DISPATCHED", "AT_PICKUP", "EN_ROUTE", "UNLOADING", "READY", "STOP", "REST", "HOME", "VACATION"];

/* ------------------------------------------------------------------ */
/* Finance, claims                                                     */
/* ------------------------------------------------------------------ */

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PAID", "VOID"] as const;

export const CLAIM_TYPES = ["CARGO_DAMAGE", "CARGO_LOSS", "LATE_CARGO", "OSD", "ACCIDENT", "EQUIPMENT_DAMAGE", "INJURY", "OTHER"] as const;
export const CLAIM_TYPE_LABELS: Record<string, string> = {
  CARGO_DAMAGE: "Cargo damage", CARGO_LOSS: "Cargo loss", LATE_CARGO: "Late cargo", OSD: "OS&D",
  ACCIDENT: "Accident / liability", EQUIPMENT_DAMAGE: "Equipment damage", INJURY: "Injury", OTHER: "Other",
};
export const CLAIM_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CLAIM_STATUSES = ["REPORTED", "UNDER_REVIEW", "DOCS_COLLECTED", "SUBMITTED", "NEGOTIATION", "APPROVED", "DENIED", "PAID", "CLOSED", "DISPUTED", "LITIGATION"] as const;
export const CLAIM_OPEN_STATUSES = ["REPORTED", "UNDER_REVIEW", "DOCS_COLLECTED", "SUBMITTED", "NEGOTIATION", "DISPUTED", "LITIGATION"] as const;
export const CLAIM_FAULTS = ["OURS", "THIRD_PARTY", "SHARED", "UNKNOWN"] as const;
export const CLAIM_FAULT_LABELS: Record<string, string> = { OURS: "Ours", THIRD_PARTY: "Third party", SHARED: "Shared", UNKNOWN: "Unknown" };

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

// Known depots / cities used for quick route entry and demo data.
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
