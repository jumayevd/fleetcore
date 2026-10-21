import { Megaphone } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { LinkButton, LiveDot, PageHeader, Tip } from "@/components/ui";
import { canAccessRoom, chatContext, chatMe, fetchMessages, listRooms, roomMeta } from "@/components/chat/data";
import { COMPANY_ROOM, PAGE_SIZE, dayKeyOf, parseRoom } from "@/components/chat/shared";
import { ChatWorkspace } from "@/components/chat/workspace";

export const metadata = { title: "Chat" };

/**
 * Team chat: company room, team room(s) and a thread per active load (`?room=load:<id>`, linked from the
 * load page). Everyone with chat.view — drivers included — can open it; room access is checked server-side.
 */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const user = await requireUser("chat.view");
  const sp = await searchParams;
  const requested = typeof sp.room === "string" && sp.room ? sp.room : COMPANY_ROOM;

  const ctx = await chatContext(user);
  const listed = await listRooms(ctx);
  let rooms = listed.rooms;
  let room = requested;
  let notice: string | null = null;

  if (!rooms.some((r) => r.id === room)) {
    // A thread that isn't in the column (e.g. a delivered load opened from its page) is fine if the viewer may read it.
    const meta = (await canAccessRoom(ctx, room)) ? await roomMeta(ctx, room) : null;
    if (meta) {
      const firstLoad = rooms.findIndex((r) => r.kind === "load");
      rooms = meta.kind === "load" && firstLoad >= 0 ? [...rooms.slice(0, firstLoad), meta, ...rooms.slice(firstLoad)] : [...rooms, meta];
    } else {
      notice = parseRoom(room) ? "That thread isn't available to you — showing the company room instead." : "That room doesn't exist — showing the company room instead.";
      room = COMPANY_ROOM;
    }
  }

  const { messages, hasMore } = await fetchMessages(room, { take: PAGE_SIZE });
  const teams = rooms.filter((r) => r.kind === "team").length;
  // Counted before a thread opened from elsewhere (e.g. a delivered load) is added to the column.
  const loadsShown = listed.rooms.filter((r) => r.kind === "load").length;
  const total = listed.loadTotal;
  const capped = loadsShown < total;
  const loadNote = capped ? `Showing ${loadsShown} of ${total}, latest conversations first. Open the others from their load page.` : null;

  return (
    <div className="flex min-h-[480px] flex-col h-[calc(100dvh-76px)] lg:h-[calc(100dvh-84px)]">
      <PageHeader
        eyebrow="Team"
        title="Chat"
        subtitle={
          <Tip content={`Company room · ${teams} team ${teams === 1 ? "room" : "rooms"} · ${capped ? `${loadsShown} of ${total}` : total} active load ${total === 1 ? "thread" : "threads"}. Refreshes every 4 s.`}>
            <LiveDot />
          </Tip>
        }
        actions={<LinkButton href="/announcements" variant="secondary"><Megaphone />Announcements</LinkButton>}
      />
      <ChatWorkspace rooms={rooms} active={room} initial={messages} hasMore={hasMore} me={chatMe(user)} notice={notice}
        today={dayKeyOf(new Date())} loadNote={loadNote} />
    </div>
  );
}
