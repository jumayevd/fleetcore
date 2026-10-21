import "server-only";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth";
import { COMPANY_ROOM, PAGE_SIZE, parseRoom, previewOf, type ChatMe, type ChatMessageDTO, type RoomSummary } from "./shared";

/* Server-side data for chat: who may read which room, the rooms column and message pages. */

export type ChatContext = {
  user: CurrentUser;
  /** The user's team: User.teamId for staff, Driver.teamId for drivers. */
  teamId: string | null;
  driverId: string | null;
  /** Owner, admin and dispatchers may open any team room. */
  anyTeam: boolean;
  /** Owner and admin see every team in the rooms column. */
  allTeams: boolean;
  loadsView: boolean;
};

export async function chatContext(user: CurrentUser): Promise<ChatContext> {
  const [u, d] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { teamId: true } }),
    user.driver ? db.driver.findUnique({ where: { id: user.driver.id }, select: { teamId: true } }) : Promise.resolve(null),
  ]);
  return {
    user,
    teamId: u?.teamId ?? d?.teamId ?? null,
    driverId: user.driver?.id ?? null,
    anyTeam: ["OWNER", "ADMIN", "DISPATCHER"].includes(user.role),
    allTeams: ["OWNER", "ADMIN"].includes(user.role),
    loadsView: can(user.role, "loads.view"),
  };
}

export const chatMe = (user: CurrentUser): ChatMe => ({ id: user.id, name: user.name, canViewLoads: can(user.role, "loads.view") });

/**
 * Room access: company — everyone with chat.view; team:<id> — members of that team or owner / admin /
 * dispatchers; load:<id> — staff with loads.view or the load's own driver.
 */
export async function canAccessRoom(ctx: ChatContext, room: string): Promise<boolean> {
  const p = parseRoom(room);
  if (!p) return false;
  if (p.kind === "company") return true;
  if (p.kind === "team") {
    if (ctx.teamId === p.teamId) return true;
    if (!ctx.anyTeam) return false;
    return Boolean(await db.team.findUnique({ where: { id: p.teamId }, select: { id: true } }));
  }
  const load = await db.load.findUnique({ where: { id: p.loadId }, select: { driverId: true } });
  if (!load) return false;
  return ctx.loadsView || (Boolean(ctx.driverId) && load.driverId === ctx.driverId);
}

type LoadRow = { id: string; reference: string; status: string; originCity: string; destCity: string; driver: { name: string } | null };
const LOAD_SELECT = { id: true, reference: true, status: true, originCity: true, destCity: true, driver: { select: { name: true } } } as const;
type TeamRow = { id: string; name: string; _count: { users: number; drivers: number } };
const TEAM_SELECT = { id: true, name: true, _count: { select: { users: true, drivers: true } } } as const;

const companyRoom = (): RoomSummary => ({ id: COMPANY_ROOM, kind: "company", name: "Company", subtitle: "Everyone", status: null, href: null, lastAt: null, lastPreview: null, lastBy: null });
const teamRoom = (t: TeamRow): RoomSummary => {
  const n = t._count.users + t._count.drivers;
  return { id: `team:${t.id}`, kind: "team", name: t.name, subtitle: `${n} ${n === 1 ? "member" : "members"}`, status: null, href: null, lastAt: null, lastPreview: null, lastBy: null };
};
const loadRoom = (l: LoadRow, ctx: ChatContext): RoomSummary => ({
  id: `load:${l.id}`, kind: "load", name: l.reference,
  subtitle: `${l.originCity} → ${l.destCity}${l.driver ? ` · ${l.driver.name}` : ""}`,
  status: l.status,
  href: ctx.loadsView ? `/loads/${l.id}` : ctx.driverId ? "/driver" : null,
  lastAt: null, lastPreview: null, lastBy: null,
});

type LastRow = { room: string; body: string; createdAt: Date; userName: string | null };

/**
 * Attach the latest message of each room. One round trip, bounded work: for each room a backward scan of the
 * (room, createdAt) index stops at the first row (LATERAL … LIMIT 1), so cost grows with the number of rooms,
 * not with the history. (Prisma's `distinct` would run in memory over every message of every room.)
 */
async function withLastMessage(rooms: RoomSummary[]) {
  if (!rooms.length) return rooms;
  const ids = rooms.map((r) => r.id);
  const last = await db.$queryRaw<LastRow[]>`
    SELECT r.room, m.body, m."createdAt", u.name AS "userName"
    FROM unnest(${ids}::text[]) AS r(room)
    CROSS JOIN LATERAL (
      SELECT c.body, c."createdAt", c."userId" FROM "ChatMessage" c
      WHERE c.room = r.room ORDER BY c."createdAt" DESC LIMIT 1
    ) m
    LEFT JOIN "User" u ON u.id = m."userId"`;
  const byRoom = new Map(last.map((m) => [m.room, m]));
  return rooms.map((r) => {
    const m = byRoom.get(r.id);
    return m ? { ...r, lastAt: m.createdAt.toISOString(), lastPreview: previewOf(m.body), lastBy: m.userName ?? "Former user" } : r;
  });
}

/** Load threads shown in the column. */
const LOAD_ROOMS = 60;
/** Active loads checked for conversation before the cap (one index lookup each), so talked-in threads survive it. */
const LOAD_SCAN = 500;

/**
 * Rooms for the left column: Company; the user's team (all teams for owner / admin); active load threads —
 * ASSIGNED / IN_TRANSIT loads for staff with loads.view, the driver's own active loads for a driver. Load threads
 * with conversation come first (latest first), then quiet ones in-transit-first; at most LOAD_ROOMS are listed and
 * `loadTotal` counts them all.
 */
export async function listRooms(ctx: ChatContext): Promise<{ rooms: RoomSummary[]; loadTotal: number }> {
  const teamWhere = ctx.allTeams ? {} : ctx.teamId ? { id: ctx.teamId } : { id: "__none__" };
  const loadWhere = ctx.loadsView
    ? { status: { in: ["ASSIGNED", "IN_TRANSIT"] } }
    : ctx.driverId ? { driverId: ctx.driverId, status: { in: ["ASSIGNED", "IN_TRANSIT"] } } : null;
  const [teams, loads] = await Promise.all([
    db.team.findMany({ where: teamWhere, orderBy: { sortOrder: "asc" }, select: TEAM_SELECT }),
    loadWhere ? db.load.findMany({ where: loadWhere, orderBy: [{ status: "desc" }, { pickupAt: "asc" }], select: LOAD_SELECT, take: LOAD_SCAN }) : Promise.resolve([] as LoadRow[]),
  ]);
  const [rooms, loadTotal] = await Promise.all([
    withLastMessage([companyRoom(), ...teams.map(teamRoom), ...loads.map((l) => loadRoom(l, ctx))]),
    loadWhere && loads.length === LOAD_SCAN ? db.load.count({ where: loadWhere }) : Promise.resolve(loads.length),
  ]);
  const loadRooms = rooms.filter((r) => r.kind === "load");
  const talked = loadRooms.filter((r) => r.lastAt).sort((a, b) => ((a.lastAt as string) < (b.lastAt as string) ? 1 : -1));
  const quiet = loadRooms.filter((r) => !r.lastAt);
  return { rooms: [...rooms.filter((r) => r.kind !== "load"), ...[...talked, ...quiet].slice(0, LOAD_ROOMS)], loadTotal };
}

/** Summary for a room that is accessible but not in the column (e.g. a delivered load opened from its page). */
export async function roomMeta(ctx: ChatContext, room: string): Promise<RoomSummary | null> {
  const p = parseRoom(room);
  if (!p) return null;
  if (p.kind === "company") return (await withLastMessage([companyRoom()]))[0];
  if (p.kind === "team") {
    const t = await db.team.findUnique({ where: { id: p.teamId }, select: TEAM_SELECT });
    return t ? (await withLastMessage([teamRoom(t)]))[0] : null;
  }
  const l = await db.load.findUnique({ where: { id: p.loadId }, select: LOAD_SELECT });
  return l ? (await withLastMessage([loadRoom(l, ctx)]))[0] : null;
}


export const toMessageDTO = (m: { id: string; room: string; userId: string | null; body: string; createdAt: Date; user: { name: string } | null }): ChatMessageDTO => ({
  id: m.id, room: m.room, userId: m.userId, userName: m.user?.name ?? "Former user", body: m.body, createdAt: m.createdAt.toISOString(),
});

const MSG_INCLUDE = { user: { select: { name: true } } } as const;

/**
 * Messages for a room. `after` returns everything at or after that instant, oldest first (polling; the
 * client de-duplicates by id). Otherwise the latest page (optionally `before` a timestamp), oldest first.
 */
export async function fetchMessages(room: string, opts: { after?: Date; before?: Date; take?: number } = {}): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  if (opts.after) {
    const rows = await db.chatMessage.findMany({ where: { room, createdAt: { gte: opts.after } }, orderBy: { createdAt: "asc" }, take: 500, include: MSG_INCLUDE });
    return { messages: rows.map(toMessageDTO), hasMore: false };
  }
  const take = Math.min(Math.max(opts.take ?? PAGE_SIZE, 1), 200);
  const rows = await db.chatMessage.findMany({
    where: { room, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: "desc" }, take: take + 1, include: MSG_INCLUDE,
  });
  const hasMore = rows.length > take;
  return { messages: rows.slice(0, take).reverse().map(toMessageDTO), hasMore };
}
