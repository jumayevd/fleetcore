"use client";

import { useCallback, useMemo, useState } from "react";
import { RoomSelect, RoomsColumn } from "./rooms";
import { ChatThread } from "./thread";
import { previewOf, type ChatMe, type ChatMessageDTO, type RoomSummary } from "./shared";

type Preview = Pick<RoomSummary, "lastAt" | "lastPreview" | "lastBy">;

/**
 * Rooms column + active thread. Room data comes from the server page; previews for the open room are
 * refreshed client-side as messages arrive so the column never lags behind the conversation.
 */
export function ChatWorkspace({ rooms, active, initial, hasMore, me, notice, today, loadNote }: {
  rooms: RoomSummary[]; active: string; initial: ChatMessageDTO[]; hasMore: boolean; me: ChatMe; notice: string | null;
  /** The server's company-calendar day, so time and day labels hydrate unchanged. */
  today: string;
  /** Shown under the load threads when the column is capped. */
  loadNote: string | null;
}) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const merged = useMemo(
    () => rooms.map((r) => { const p = previews[r.id]; return p && (!r.lastAt || (p.lastAt as string) > r.lastAt) ? { ...r, ...p } : r; }),
    [rooms, previews],
  );
  const current = merged.find((r) => r.id === active) ?? null;
  const onLatest = useCallback((m: ChatMessageDTO) => {
    setPreviews((p) => ({ ...p, [m.room]: { lastAt: m.createdAt, lastPreview: previewOf(m.body), lastBy: m.userName } }));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
      <RoomsColumn rooms={merged} active={active} today={today} loadNote={loadNote} className="hidden lg:flex" />
      <div className="flex min-w-0 flex-1 flex-col">
        <RoomSelect rooms={merged} active={active} className="lg:hidden" />
        <ChatThread key={active} room={active} meta={current} initial={initial} hasMore={hasMore} me={me} notice={notice} onLatest={onLatest} today={today} />
      </div>
    </div>
  );
}
