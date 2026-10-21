import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canAccessRoom, chatContext, chatMe, fetchMessages } from "@/components/chat/data";
import { PAGE_SIZE, parseRoom, type ChatApiResponse } from "@/components/chat/shared";

export const dynamic = "force-dynamic";

const parseDate = (v: string | null) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Messages for a chat room, polled every 4 s by the thread.
 *   GET /api/chat?room=company|team:<id>|load:<id>            → latest page, oldest first
 *   GET /api/chat?room=…&after=<iso>                           → messages at or after that instant
 *   GET /api/chat?room=…&before=<iso>[&take=n]                 → the page before that instant
 * Same access rules as sendMessage. Responses are never cached.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "chat.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const room = sp.get("room") ?? "company";
  if (!parseRoom(room)) return NextResponse.json({ error: "Unknown room" }, { status: 400 });
  const after = parseDate(sp.get("after"));
  const before = parseDate(sp.get("before"));
  if (after === null || before === null) return NextResponse.json({ error: "Bad timestamp" }, { status: 400 });
  const takeRaw = Number(sp.get("take") ?? PAGE_SIZE);
  const take = Number.isFinite(takeRaw) ? takeRaw : PAGE_SIZE;

  if (!(await canAccessRoom(await chatContext(user), room))) return NextResponse.json({ error: "You don't have access to this room" }, { status: 403 });

  const { messages, hasMore } = await fetchMessages(room, { after, before, take });
  const body: ChatApiResponse = { room, me: chatMe(user), messages, hasMore, serverTime: new Date().toISOString() };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
