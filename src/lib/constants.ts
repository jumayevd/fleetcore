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

/**
 * ACTIVE: in service, shown as Available without a driver and Assigned with one (both automatic) · MAINTENANCE: In shop,
 * only through a repair order in the shop · VENDOR: belongs to another company or owner (not leased), set by hand ·
 * OUT_OF_SERVICE: held by a "fix before next load" defect, never set by hand · INACTIVE: set by hand with a reason.
 */
export const TRUCK_STATUSES = ["ACTIVE", "MAINTENANCE", "VENDOR", "OUT_OF_SERVICE", "INACTIVE"] as const;
/** What the status menu offers. In shop opens a repair order; Out of service only comes from a defect. */
export const PICKABLE_TRUCK_STATUSES = ["ACTIVE", "MAINTENANCE", "VENDOR", "INACTIVE"] as const;
/** Why a truck is set Inactive (Truck.statusReason). */
export const INACTIVE_REASONS = ["SOLD", "ACCIDENT", "STOLEN", "TOTAL_LOSS", "RETURNED", "MECHANICAL", "OTHER"] as const;
export const INACTIVE_REASON_LABELS: Record<string, string> = {
  SOLD: "Sold", ACCIDENT: "Accident", STOLEN: "Stolen", TOTAL_LOSS: "Total loss", RETURNED: "Returned (lease / owner)",
  MECHANICAL: "Mechanical failure", OTHER: "Other",
};
/** Why a truck goes into the shop, and the repair type its repair order opens with. */
export const IN_SHOP_REASONS = [{ value: "ACCIDENT", label: "Accident repair" }, { value: "REPAIR", label: "Repair" }] as const;
export const OWNERSHIP = ["COMPANY", "OWNER_OPERATOR", "LEASED"] as const;
export const OWNERSHIP_LABELS: Record<string, string> = { COMPANY: "Company", OWNER_OPERATOR: "Owner-operator", LEASED: "Leased" };

/** As for trucks: SHOP is In shop; INACTIVE is sold or parked for good and stops counting in the fleet. */
export const TRAILER_STATUSES = ["IN_USE", "EMPTY", "DROPPED", "YARD", "SHOP", "OUT_OF_SERVICE", "INACTIVE"] as const;
export const TRAILER_STATUS_LABELS: Record<string, string> = {
  IN_USE: "In use", EMPTY: "Empty", DROPPED: "Dropped", YARD: "Yard", SHOP: "In shop", OUT_OF_SERVICE: "Out of service", INACTIVE: "Inactive",
};
/** Trailers left out of paperwork checks: held out of service, or no longer in the fleet. */
export const TRAILER_OFF_PAPERWORK = ["OUT_OF_SERVICE", "INACTIVE"];

export const WORK_ORDER_CATEGORIES = ["PM", "ENGINE", "COOLING", "TIRES", "BRAKES", "ELECTRICAL", "BODY", "TOWING", "INSPECTION", "OTHER"] as const;
export const WORK_ORDER_CATEGORY_LABELS: Record<string, string> = {
  PM: "PM service", ENGINE: "Engine & drivetrain", COOLING: "Cooling", TIRES: "Tires & wheels", BRAKES: "Brakes",
  ELECTRICAL: "Electrical", BODY: "Body / accident", TOWING: "Towing", INSPECTION: "Inspection", OTHER: "Other",
};
export const WORK_ORDER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const WORK_ORDER_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

/* ------------------------------------------------------------------ */
/* Repair orders (WorkOrder) and vendors                               */
/* ------------------------------------------------------------------ */

/** What kind of visit it is (WorkOrder.repairType). Oil change and DOT inspection reset their schedules when completed. */
export const REPAIR_TYPES = ["OIL_CHANGE", "DOT_INSPECTION", "PM_INSPECTION", "REPAIR", "ENGINE", "ELECTRICAL", "FRAME", "BODY", "STEER", "DPF", "INJECTOR", "COMPUTER", "ACCIDENT", "TIRES", "OTHER"] as const;
export const REPAIR_TYPE_LABELS: Record<string, string> = {
  OIL_CHANGE: "Oil change", DOT_INSPECTION: "Annual DOT inspection", PM_INSPECTION: "PM / mid-trip inspection", REPAIR: "Repair",
  ENGINE: "Engine", ELECTRICAL: "Electrical harness", FRAME: "Frame", BODY: "Body", STEER: "Steering components", DPF: "DPF / aftertreatment",
  INJECTOR: "Injectors", COMPUTER: "Computer / module", ACCIDENT: "Accident repair", TIRES: "Tires", OTHER: "Other",
};

/** The system a line of work belongs to (WorkOrderLine.system), so repeat problems show up per system. */
export const REPAIR_SYSTEMS = ["BODY", "BRAKES", "ELECTRICAL", "TIRES", "ENGINE", "COOLING", "EXHAUST", "HVAC", "SUSPENSION", "PM", "FEES", "OTHER"] as const;
export const REPAIR_SYSTEM_LABELS: Record<string, string> = {
  BODY: "Body & doors", BRAKES: "Brakes", ELECTRICAL: "Electrical & lights", TIRES: "Tires & wheels", ENGINE: "Engine", COOLING: "Cooling",
  EXHAUST: "Exhaust / aftertreatment", HVAC: "HVAC", SUSPENSION: "Suspension & steering", PM: "PM / oil change", FEES: "Fees & supplies", OTHER: "Other",
};

/** Where a job in the shop has got to (WorkOrder.stage, while IN_PROGRESS), in order. */
export const REPAIR_STAGES = ["DIAGNOSING", "WAITING_APPROVAL", "WAITING_PARTS", "IN_REPAIR", "QUALITY_CHECK", "READY_PICKUP"] as const;
export const REPAIR_STAGE_LABELS: Record<string, string> = {
  DIAGNOSING: "Diagnosing", WAITING_APPROVAL: "Waiting for approval", WAITING_PARTS: "Waiting for parts", IN_REPAIR: "In repair",
  QUALITY_CHECK: "Quality check / road test", READY_PICKUP: "Ready for pickup",
};

/** Who pays for a repair (WorkOrder.payer). */
export const PAYERS = ["COMPANY", "DRIVER", "INVESTIGATION", "WARRANTY"] as const;
export const PAYER_LABELS: Record<string, string> = {
  COMPANY: "Company expense", DRIVER: "Driver charge", INVESTIGATION: "Under investigation", WARRANTY: "Warranty claim",
};
export const PAYER_HINTS: Record<string, string> = {
  COMPANY: "Goes on the company's books.",
  DRIVER: "Taken off what the driver earns, and only once the driver has been told.",
  INVESTIGATION: "Held until a manager or safety decides who pays.",
  WARRANTY: "Claimed back from the maker or the shop.",
};
export const PAYMENT_STATUSES = ["PAID", "PAY_LATER"] as const;
export const PAYMENT_STATUS_LABELS: Record<string, string> = { PAID: "Paid", PAY_LATER: "To pay" };

export const VENDOR_TYPES = ["DEALER", "SHOP", "TIRE", "MOBILE", "TOWING", "PARTS", "OTHER"] as const;
export const VENDOR_TYPE_LABELS: Record<string, string> = {
  DEALER: "Dealer", SHOP: "Repair shop", TIRE: "Tire shop", MOBILE: "Road-side / mobile", TOWING: "Towing", PARTS: "Parts supplier", OTHER: "Other",
};

/* ------------------------------------------------------------------ */
/* Walk-arounds (weekly pre-trip inspection) and defects               */
/* ------------------------------------------------------------------ */

/** What a reviewer checks on the weekly walk-around video, in walk-around order. */
export const PTI_COMPONENTS = [
  "STEER_TIRES", "DRIVE_TIRES", "TRAILER_TIRES", "BRAKES", "LIGHTS", "LEAKS", "SUSPENSION", "BELTS_HOSES", "BATTERY",
  "GLASS_MIRRORS", "BODY", "COUPLING", "TRAILER",
] as const;
export const PTI_COMPONENT_LABELS: Record<string, string> = {
  STEER_TIRES: "Steer tires", DRIVE_TIRES: "Drive tires", TRAILER_TIRES: "Trailer tires", BRAKES: "Brakes", LIGHTS: "Lights & reflectors",
  LEAKS: "Leaks & fluids", SUSPENSION: "Suspension / airbags", BELTS_HOSES: "Belts & hoses", BATTERY: "Battery & electrical",
  GLASS_MIRRORS: "Windshield & mirrors", BODY: "Body & mud flaps", COUPLING: "5th wheel / coupling", TRAILER: "Trailer condition",
};
/** GOOD · SOON (within 2 weeks) · NOW (before the next load) · UNSEEN (could not see it — never counts as healthy). */
export const PTI_RATINGS = ["GOOD", "SOON", "NOW", "UNSEEN"] as const;
export const PTI_RATING_LABELS: Record<string, string> = { GOOD: "Good", SOON: "Soon", NOW: "Now", UNSEEN: "Not seen" };

export const DEFECT_SEVERITIES = ["NOW", "SOON", "WATCH"] as const;
export const DEFECT_SEVERITY_LABELS: Record<string, string> = { NOW: "Fix before next load", SOON: "Fix within 2 weeks", WATCH: "Watch" };
/** Days to fix by severity (dueAt = foundAt + this). */
export const DEFECT_DUE_DAYS: Record<string, number> = { NOW: 0, SOON: 14, WATCH: 30 };
export const DEFECT_STATUSES = ["OPEN", "REPAIRED", "CLOSED"] as const;
export const DEFECT_STATUS_LABELS: Record<string, string> = { OPEN: "Open", REPAIRED: "Repaired · to confirm", CLOSED: "Closed" };

/* ------------------------------------------------------------------ */
/* Roadside inspections                                                */
/* ------------------------------------------------------------------ */

export const INSPECTION_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export const INSPECTION_LEVEL_LABELS: Record<number, string> = {
  1: "Level I · full", 2: "Level II · walk-around", 3: "Level III · driver only", 4: "Level IV · special", 5: "Level V · vehicle only", 6: "Level VI · radioactive",
};
export const ROADSIDE_RESULTS = ["CLEAN", "VIOLATIONS", "OOS"] as const;
export const ROADSIDE_RESULT_LABELS: Record<string, string> = { CLEAN: "Clean", VIOLATIONS: "Violations", OOS: "Out of service" };
export const ROADSIDE_STATUSES = ["OPEN", "CORRECTED", "CLOSED"] as const;
export const ROADSIDE_STATUS_LABELS: Record<string, string> = { OPEN: "Open", CORRECTED: "Corrected", CLOSED: "Closed" };

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
  // United States: freight hubs and terminals
  { name: "Naperville, IL", country: "US", lat: 41.7508, lng: -88.1535 },
  { name: "Chicago, IL", country: "US", lat: 41.8781, lng: -87.6298 },
  { name: "Joliet, IL", country: "US", lat: 41.525, lng: -88.0817 },
  { name: "Indianapolis, IN", country: "US", lat: 39.7684, lng: -86.1581 },
  { name: "Columbus, OH", country: "US", lat: 39.9612, lng: -82.9988 },
  { name: "Toledo, OH", country: "US", lat: 41.6528, lng: -83.5379 },
  { name: "Detroit, MI", country: "US", lat: 42.3314, lng: -83.0458 },
  { name: "Pittsburgh, PA", country: "US", lat: 40.4406, lng: -79.9959 },
  { name: "Harrisburg, PA", country: "US", lat: 40.2732, lng: -76.8867 },
  { name: "Allentown, PA", country: "US", lat: 40.6084, lng: -75.4902 },
  { name: "Newark, NJ", country: "US", lat: 40.7357, lng: -74.1724 },
  { name: "Parsippany, NJ", country: "US", lat: 40.8579, lng: -74.4259 },
  { name: "New York, NY", country: "US", lat: 40.7128, lng: -74.006 },
  { name: "Albany, NY", country: "US", lat: 42.6526, lng: -73.7562 },
  { name: "Boston, MA", country: "US", lat: 42.3601, lng: -71.0589 },
  { name: "Baltimore, MD", country: "US", lat: 39.2904, lng: -76.6122 },
  { name: "Richmond, VA", country: "US", lat: 37.5407, lng: -77.436 },
  { name: "Charlotte, NC", country: "US", lat: 35.2271, lng: -80.8431 },
  { name: "Lumberton, NC", country: "US", lat: 34.6182, lng: -79.0086 },
  { name: "Atlanta, GA", country: "US", lat: 33.749, lng: -84.388 },
  { name: "Savannah, GA", country: "US", lat: 32.0809, lng: -81.0912 },
  { name: "Jacksonville, FL", country: "US", lat: 30.3322, lng: -81.6557 },
  { name: "Orlando, FL", country: "US", lat: 28.5383, lng: -81.3792 },
  { name: "Miami, FL", country: "US", lat: 25.7617, lng: -80.1918 },
  { name: "Nashville, TN", country: "US", lat: 36.1627, lng: -86.7816 },
  { name: "Memphis, TN", country: "US", lat: 35.1495, lng: -90.049 },
  { name: "Knoxville, TN", country: "US", lat: 35.9606, lng: -83.9207 },
  { name: "Louisville, KY", country: "US", lat: 38.2527, lng: -85.7585 },
  { name: "St. Louis, MO", country: "US", lat: 38.627, lng: -90.1994 },
  { name: "Kansas City, MO", country: "US", lat: 39.0997, lng: -94.5786 },
  { name: "Dallas, TX", country: "US", lat: 32.7767, lng: -96.797 },
  { name: "Fort Worth, TX", country: "US", lat: 32.7555, lng: -97.3308 },
  { name: "Houston, TX", country: "US", lat: 29.7604, lng: -95.3698 },
  { name: "San Antonio, TX", country: "US", lat: 29.4241, lng: -98.4936 },
  { name: "Laredo, TX", country: "US", lat: 27.5306, lng: -99.4803 },
  { name: "Oklahoma City, OK", country: "US", lat: 35.4676, lng: -97.5164 },
  { name: "Little Rock, AR", country: "US", lat: 34.7465, lng: -92.2896 },
  { name: "Denver, CO", country: "US", lat: 39.7392, lng: -104.9903 },
  { name: "Phoenix, AZ", country: "US", lat: 33.4484, lng: -112.074 },
  { name: "Los Angeles, CA", country: "US", lat: 34.0522, lng: -118.2437 },
  { name: "Stockton, CA", country: "US", lat: 37.9577, lng: -121.2908 },
  { name: "Salt Lake City, UT", country: "US", lat: 40.7608, lng: -111.891 },
  { name: "Minneapolis, MN", country: "US", lat: 44.9778, lng: -93.265 },
];

/** Nearest known city for a coordinate — used for "last seen near …" labels. `units` picks km or mi in the label. */
export function nearestCity(lat: number, lng: number, units: "metric" | "imperial" = "metric") {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + ((c.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  const km = Math.sqrt(bestD) * 111;
  const away = units === "imperial" ? `${Math.round(km / 1.609344)} mi` : `${Math.round(km)} km`;
  return { city: best, km: Math.round(km), label: km < 15 ? best.name : `${away} from ${best.name}` };
}
