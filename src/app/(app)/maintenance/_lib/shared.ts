/** Plain values shared by the maintenance pages and the client form (server and client safe, no imports). */

/** Vendor for jobs done in the company's own shop. New work orders start with it; the demo data uses it too. */
export const IN_HOUSE_VENDOR = "In-house workshop";

/** How a work order without a vendor reads everywhere (same wording as the repair log filter). */
export const NO_VENDOR = "No vendor recorded";

/** "1 unit" / "3 units". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why a job cannot start: its unit is still on a load. The fleet pages refuse the same move. */
export const onLoadReason = (unit: string, load: string) =>
  `${unit} is on ${load}. Recover the load to another unit before starting this job.`;
