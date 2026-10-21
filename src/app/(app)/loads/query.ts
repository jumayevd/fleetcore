import "server-only";
import type { Prisma } from "@prisma/client";
import { BILLING_STAGES, LOAD_STATUSES, type BillingStage, type LoadStatus } from "@/lib/constants";
import { daysAgo } from "@/lib/format";

/* URL-driven filters shared by the list page, the board and the CSV export. */

export type LoadFilters = {
  view: "table" | "board";
  status?: LoadStatus;
  billing?: BillingStage;
  /** Team id, or "none" for loads without a team. */
  team?: string;
  /** Customer or broker id (matches either side of the load). */
  party?: string;
  /** Pickup date range, yyyy-mm-dd (inclusive). */
  from?: string;
  to?: string;
  q: string;
  /** 1-based table page (ignored by the board and the export). */
  page: number;
};

/** Table rows per page, and cards per board column before "+n more". */
export const PAGE_SIZE = 50;
export const BOARD_COLUMN_CAP = 25;

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLoadFilters(sp: Record<string, string | string[] | undefined>): LoadFilters {
  const status = str(sp.status);
  const billing = str(sp.billing);
  const from = str(sp.from);
  const to = str(sp.to);
  return {
    view: sp.view === "board" ? "board" : "table",
    status: status && (LOAD_STATUSES as readonly string[]).includes(status) ? (status as LoadStatus) : undefined,
    billing: billing && (BILLING_STAGES as readonly string[]).includes(billing) ? (billing as BillingStage) : undefined,
    team: str(sp.team),
    party: str(sp.party),
    from: from && DAY_RE.test(from) ? from : undefined,
    to: to && DAY_RE.test(to) ? to : undefined,
    q: str(sp.q) ?? "",
    page: Math.max(1, Math.min(10_000, Math.trunc(Number(str(sp.page))) || 1)),
  };
}

/**
 * `/loads?…` with the current filters, patched. Pass `undefined` in the patch to drop a key.
 * The page number is kept only when the patch sets it, so any filter change starts again at page 1.
 */
export function loadsHref(f: LoadFilters, patch: Partial<Record<keyof LoadFilters, string | undefined>> = {}, base = "/loads") {
  const merged: Record<string, string | undefined> = {
    view: f.view === "board" ? "board" : undefined, status: f.status, billing: f.billing, team: f.team, party: f.party,
    from: f.from, to: f.to, q: f.q || undefined, ...patch,
    page: patch.page && patch.page !== "1" ? patch.page : undefined,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const hasActiveFilters = (f: LoadFilters) => Boolean(f.status || f.billing || f.team || f.party || f.from || f.to || f.q);

/** Human label for the pickup-date period (for KPI hints). */
export function periodLabel(f: LoadFilters) {
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  if (f.from && f.to) return `pickup ${fmt(f.from)} – ${fmt(f.to)}`;
  if (f.from) return `pickup from ${fmt(f.from)}`;
  if (f.to) return `pickup until ${fmt(f.to)}`;
  return "all time";
}

/** Prisma `where` for the filters. `withStatus: false` leaves the status out (for the status pill counts). */
export function loadWhere(f: LoadFilters, opts: { withStatus?: boolean } = {}): Prisma.LoadWhereInput {
  const withStatus = opts.withStatus ?? true;
  const and: Prisma.LoadWhereInput[] = [];
  if (f.view === "board") {
    and.push({ OR: [{ status: { in: ["PLANNED", "ASSIGNED", "IN_TRANSIT"] } }, { status: "DELIVERED", deliveredAt: { gte: daysAgo(7) } }] });
  } else if (withStatus && f.status) {
    and.push({ status: f.status });
  }
  if (f.billing) and.push({ billingStage: f.billing });
  if (f.team) and.push(f.team === "none" ? { teamId: null } : { teamId: f.team });
  if (f.party) and.push({ OR: [{ customerId: f.party }, { brokerId: f.party }] });
  if (f.from) and.push({ pickupAt: { gte: new Date(`${f.from}T00:00:00`) } });
  if (f.to) and.push({ pickupAt: { lt: new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000) } });
  if (f.q) {
    const like = { contains: f.q, mode: "insensitive" as const };
    and.push({ OR: [
      { reference: like }, { customerRef: like }, { originCity: like }, { destCity: like }, { originName: like }, { destName: like }, { commodity: like },
      { customer: { name: like } }, { broker: { name: like } }, { driver: { name: like } }, { truck: { unitNumber: like } }, { trailer: { unitNumber: like } },
      { stops: { some: { city: like } } },
    ] });
  }
  return and.length ? { AND: and } : {};
}

/** Columns the list, board and export need. */
export const LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  broker: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, color: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, name: true } },
  _count: { select: { stops: true } },
} satisfies Prisma.LoadInclude;

export type ListLoad = Prisma.LoadGetPayload<{ include: typeof LIST_INCLUDE }>;
