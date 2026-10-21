/** Where report rows lead (server and client safe). */

export const truckHref = (id: string) => `/fleet/${id}`;
export const trailerHref = (id: string) => `/fleet/trailers/${id}`;
export const unitHref = (type: "truck" | "trailer", id: string) => (type === "truck" ? truckHref(id) : trailerHref(id));
export const driverHref = (id: string) => `/drivers/${id}`;
export const repairHref = (id: string) => `/maintenance/work-orders/${id}`;
export const repairsHref = (q: Record<string, string> = {}) => {
  const s = new URLSearchParams(q).toString();
  return s ? `/maintenance/work-orders?${s}` : "/maintenance/work-orders";
};
export const vendorHref = (id: string) => `/vendors/${id}`;
export const VENDORS_HREF = "/vendors";
export const DEFECTS_HREF = "/inspections/defects";
export const PRETRIP_HREF = "/inspections";
export const ROADSIDE_HREF = "/inspections/roadside";
export const roadsideHref = (id: string) => `/inspections/roadside/${id}`;
export const COMPLIANCE_HREF = "/maintenance?tab=compliance";
export const SHOP_HREF = "/maintenance";
