/** URL helpers shared by the shop pages (server and client safe). */

export const truckHref = (id: string) => `/fleet/${id}`;
export const trailerHref = (id: string) => `/fleet/trailers/${id}`;
/** The unit's paperwork: trucks have a compliance tab, trailers a documents section. */
export const unitComplianceHref = (type: "truck" | "trailer", id: string) =>
  type === "truck" ? `/fleet/${id}?tab=compliance` : `/fleet/trailers/${id}#documents`;
export const workOrderHref = (id: string) => `/maintenance/work-orders/${id}`;
export const vendorHref = (id: string) => `/vendors/${id}`;
/** The truck page's readings card, where a fresh odometer reading is entered. */
export const readingsHref = (truckId: string) => `/fleet/${truckId}#readings`;

type Query = Record<string, string | number | null | undefined>;

export function withQuery(base: string, q: Query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const maintenanceHref = (q: Query) => withQuery("/maintenance", q);
export const workOrdersHref = (q: Query) => withQuery("/maintenance/work-orders", q);
export const newWorkOrderHref = (q: Query = {}) => withQuery("/maintenance/work-orders/new", q);
/** Oil & PM board. `log=1` opens the "Log oil change" form, `book=<truckId>` the booking for a truck. */
export const oilHref = (q: Query = {}) => withQuery("/maintenance/oil", q);
export const vendorsHref = (q: Query = {}) => withQuery("/vendors", q);
