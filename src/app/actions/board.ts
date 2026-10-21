"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { BOARD_STATUSES, BOARD_STATUS_LABELS, MANUAL_BOARD_STATUSES, type BoardStatus } from "@/lib/constants";
import { WEEKLY_GOAL_KEYS } from "@/lib/stats";
import { clearDriverBoardOverride, setDriverBoardStatus } from "@/lib/workflow";
import { isYmd } from "@/app/(app)/dispatch/dates";

const ROW_COLORS = ["amber", "green", "red", "blue", "violet"];

function cellDate(ymd: string) {
  if (!isYmd(ymd)) throw new FormError("Invalid board date");
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Run a write against a driver that may have been deleted while the board was open: Prisma's "record not found" (P2025)
 * and foreign-key (P2003) errors become a message instead of an error boundary.
 */
async function forDriver<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : null;
    if (code === "P2025" || code === "P2003") throw new FormError("That driver no longer exists. Refresh the board.");
    throw e;
  }
}

/** Dispatcher override: STOP / REST / HOME / VACATION, or READY to park a driver. Optional note goes into the history. */
export async function setBoardStatus(driverId: string, status: string, note?: string | null): Promise<ActionState> {
  const me = await requireUser("board.edit");
  return attempt(async () => {
    if (!BOARD_STATUSES.includes(status as BoardStatus) || !MANUAL_BOARD_STATUSES.includes(status as BoardStatus)) {
      throw new FormError("That status is set automatically from the driver's load");
    }
    await forDriver(() => setDriverBoardStatus(driverId, status as BoardStatus, me.id, note?.trim() || null));
    revalidatePath("/dispatch");
    revalidatePath("/drivers");
    return { ok: `Status set to ${BOARD_STATUS_LABELS[status as BoardStatus]}` };
  });
}

/** Drop a manual override and re-derive the status from the driver's load. */
export async function restoreAutoStatus(driverId: string): Promise<ActionState> {
  const me = await requireUser("board.edit");
  return attempt(async () => {
    await clearDriverBoardOverride(driverId, me.id);
    const d = await forDriver(() => db.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true, boardStatus: true } }));
    await audit(me.id, "board_status", "driver", driverId, `${d.name} → automatic (${BOARD_STATUS_LABELS[d.boardStatus as BoardStatus] ?? d.boardStatus})`);
    revalidatePath("/dispatch");
    revalidatePath("/drivers");
    return { ok: "Automatic status restored" };
  });
}

/** Highlight a driver row for one day (null clears). */
export async function setRowColor(date: string, driverId: string, color: string | null): Promise<ActionState> {
  const me = await requireUser("board.edit");
  return attempt(async () => {
    const key = { date: cellDate(date), driverId, column: "row" };
    if (color !== null && !ROW_COLORS.includes(color)) throw new FormError("Unknown colour");
    if (color === null) {
      await db.boardCell.deleteMany({ where: key });
    } else {
      await forDriver(() => db.boardCell.upsert({
        where: { date_driverId_column: key },
        create: { ...key, color, updatedById: me.id },
        update: { color, updatedById: me.id },
      }));
    }
    revalidatePath("/dispatch");
    return { ok: color ? "Row coloured" : "Colour cleared" };
  });
}

/** Free-text note on a driver row for one day (empty clears). */
export async function setBoardNote(date: string, driverId: string, note: string): Promise<ActionState> {
  const me = await requireUser("board.edit");
  return attempt(async () => {
    const key = { date: cellDate(date), driverId, column: "notes" };
    const text = note.trim().slice(0, 500);
    if (!text) {
      await db.boardCell.deleteMany({ where: key });
    } else {
      await forDriver(() => db.boardCell.upsert({
        where: { date_driverId_column: key },
        create: { ...key, note: text, updatedById: me.id },
        update: { note: text, updatedById: me.id },
      }));
    }
    revalidatePath("/dispatch");
    return { ok: text ? "Note saved" : "Note cleared" };
  });
}

/** Weekly revenue goals (solo = company drivers, team = owner-operators and lease). */
export async function setWeeklyGoals(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("users.manage");
  return attempt(async () => {
    const f = fields(fd);
    const solo = f.num("solo");
    const team = f.num("team");
    if (solo === null || team === null) throw new FormError("Both goals are required");
    if (solo < 0 || team < 0 || solo > 1_000_000 || team > 1_000_000) throw new FormError("Goals must be between 0 and 1,000,000");
    await Promise.all([
      db.appSetting.upsert({ where: { key: WEEKLY_GOAL_KEYS.solo }, create: { key: WEEKLY_GOAL_KEYS.solo, value: String(Math.round(solo)) }, update: { value: String(Math.round(solo)) } }),
      db.appSetting.upsert({ where: { key: WEEKLY_GOAL_KEYS.team }, create: { key: WEEKLY_GOAL_KEYS.team, value: String(Math.round(team)) }, update: { value: String(Math.round(team)) } }),
    ]);
    await audit(me.id, "update", "setting", "weekly.goals", `solo ${Math.round(solo)} · team ${Math.round(team)}`);
    revalidatePath("/dispatch/weekly");
    return { ok: "Goals updated" };
  });
}
