"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { canAccessRoom, chatContext, toMessageDTO } from "@/components/chat/data";
import { MAX_BODY, parseRoom, type ChatMessageDTO } from "@/components/chat/shared";

/** sendMessage returns the stored message so the thread can swap its optimistic copy for the real one. */
export type SendState = (ActionState & { message?: ChatMessageDTO }) | undefined;

/**
 * Post to a room. Access: company — everyone with chat.view; team:<id> — members of that team or
 * owner / admin / dispatchers; load:<id> — staff with loads.view or the load's driver. Body 1–2000 chars.
 */
export async function sendMessage(room: string, _: SendState, fd: FormData): Promise<SendState> {
  const me = await requireUser("chat.view");
  const raw = fd.get("body");
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { error: "Type a message first" };
  if (body.length > MAX_BODY) return { error: `Keep messages under ${MAX_BODY} characters` };
  if (!parseRoom(room)) return { error: "That room doesn't exist" };
  if (!(await canAccessRoom(await chatContext(me), room))) return { error: "You don't have access to this room" };
  const m = await db.chatMessage.create({ data: { room, userId: me.id, body }, include: { user: { select: { name: true } } } });
  return { ok: "Sent", message: toMessageDTO(m) };
}

/* ------------------------------------------------------------------ */
/* Announcements (announcements.manage)                                */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000;

function revalidateAnnouncements() {
  revalidatePath("/announcements");
  revalidatePath("/chat");
  revalidatePath("/dashboard");
}

/** Create (id null) or edit an announcement: title, body, pinned, optional expiry. */
export async function saveAnnouncement(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireUser("announcements.manage");
  return attempt(async () => {
    const f = fields(fd);
    const title = f.req("title", "Title");
    if (title.length > 120) throw new FormError("Keep the title under 120 characters");
    const body = f.req("body", "Body").replace(/\r\n/g, "\n");
    if (body.length > 5000) throw new FormError("Keep the body under 5000 characters");
    const pinned = f.bool("pinned");
    const expiresAt = f.date("expiresAt");

    if (id) {
      const existing = await db.announcement.findUnique({ where: { id }, select: { title: true, expiresAt: true } });
      if (!existing) throw new FormError("That announcement no longer exists");
      // A changed expiry must be in the future; an untouched past expiry is left alone so edits to old posts still save.
      const changed = (existing.expiresAt?.getTime() ?? 0) !== (expiresAt?.getTime() ?? 0) && Math.abs((existing.expiresAt?.getTime() ?? 0) - (expiresAt?.getTime() ?? 0)) > MINUTE;
      if (expiresAt && changed && expiresAt.getTime() < Date.now()) throw new FormError("Expiry must be in the future");
      await db.announcement.update({ where: { id }, data: { title, body, pinned, expiresAt } });
      await audit(me.id, "update", "announcement", id, existing.title === title ? title : `${existing.title} → ${title}`);
      revalidateAnnouncements();
      return { ok: "Announcement updated" };
    }
    if (expiresAt && expiresAt.getTime() < Date.now()) throw new FormError("Expiry must be in the future");
    const a = await db.announcement.create({ data: { title, body, pinned, expiresAt, authorId: me.id } });
    await audit(me.id, "create", "announcement", a.id, `${title}${pinned ? " · pinned" : ""}`);
    revalidateAnnouncements();
    return { ok: pinned ? "Posted and pinned" : "Announcement posted" };
  });
}

export async function togglePin(id: string): Promise<ActionState> {
  const me = await requireUser("announcements.manage");
  const a = await db.announcement.findUnique({ where: { id }, select: { title: true, pinned: true } });
  if (!a) return { error: "That announcement no longer exists" };
  await db.announcement.update({ where: { id }, data: { pinned: !a.pinned } });
  await audit(me.id, a.pinned ? "unpin" : "pin", "announcement", id, a.title);
  revalidateAnnouncements();
  return { ok: a.pinned ? "Unpinned" : "Pinned to the top" };
}

export async function deleteAnnouncement(id: string): Promise<ActionState> {
  const me = await requireUser("announcements.manage");
  const a = await db.announcement.findUnique({ where: { id }, select: { title: true } });
  if (!a) return { error: "That announcement no longer exists" };
  await db.announcement.delete({ where: { id } });
  await audit(me.id, "delete", "announcement", id, a.title);
  revalidateAnnouncements();
  return { ok: "Announcement deleted" };
}
