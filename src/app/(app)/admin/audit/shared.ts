/** Client-safe helpers shared by the audit page (server) and its filter bar (client). */

export type AuditFilterParams = { entity?: string; user?: string; action?: string; from?: string; to?: string; q?: string };

/**
 * A real calendar day as YYYY-MM-DD, else undefined. Rejects shapes that parse to Invalid Date or roll over
 * (2026-13-45, 2026-00-10, 2026-02-30) and years outside 1900–2999: those come from half-typed or mistyped dates,
 * and year 0000 shifts to a negative ISO year in company time, which the database rejects.
 */
export function isoDay(v: string | null | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const year = Number(v.slice(0, 4));
  if (year < 1900 || year > 2999) return undefined;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : undefined;
}

/** Build the audit URL for a set of filters (page resets whenever a filter changes). */
export function auditHref(params: AuditFilterParams, patch: Partial<AuditFilterParams> & { page?: number } = {}) {
  const p = new URLSearchParams();
  const { page, ...rest } = patch;
  for (const [k, v] of Object.entries({ ...params, ...rest })) if (v) p.set(k, v);
  if (page && page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/admin/audit${s ? `?${s}` : ""}`;
}
