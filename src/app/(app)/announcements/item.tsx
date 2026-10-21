"use client";

import { useState, useTransition } from "react";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { deleteAnnouncement, togglePin } from "@/app/actions/chat";
import type { ActionState } from "@/lib/action";
import { FormMessage } from "@/components/forms";
import { Avatar, Card, Chip, IconButton, cn } from "@/components/ui";
import { Linkified } from "@/components/chat/linkify";
import { AnnouncementForm } from "./form";
import type { AnnouncementDTO } from "./shared";

/** One announcement. Managers get pin / edit / delete; edit swaps the card for the form in place. */
export function AnnouncementItem({ a, canManage, loadLinks }: { a: AnnouncementDTO; canManage: boolean; loadLinks: boolean }) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) => start(async () => { const r = await fn(); setError(r?.error ?? null); });

  if (editing) {
    return (
      <Card title={`Edit · ${a.title}`}>
        <AnnouncementForm a={a} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <article className={cn("rounded-lg border border-line bg-surface px-4 py-3", a.pinned && !a.expired && "border-l-2 border-l-accent", a.expired && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold leading-5 text-fg">{a.title}</h2>
          {a.pinned && <Chip tone="accent">Pinned</Chip>}
          {a.expired && <Chip>Expired</Chip>}
        </div>
        {canManage && (
          <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
            <IconButton label={a.pinned ? "Unpin" : "Pin to the top"} disabled={busy} onClick={() => run(() => togglePin(a.id))}>
              {a.pinned ? <PinOff /> : <Pin />}
            </IconButton>
            <IconButton label="Edit" disabled={busy} onClick={() => setEditing(true)}><Pencil /></IconButton>
            <IconButton label="Delete" disabled={busy} className="hover:text-danger"
              onClick={() => { if (window.confirm(`Delete “${a.title}”? This can't be undone.`)) run(() => deleteAnnouncement(a.id)); }}>
              <Trash2 />
            </IconButton>
          </div>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-fg"><Linkified text={a.body} loadLinks={loadLinks} /></p>
      <footer className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-fg-subtle">
        <Avatar name={a.author} size={16} className="mr-0.5" />
        <span className="text-fg-muted">{a.author}</span>
        <span>·</span>
        <span title={a.createdLabel}>{a.agoLabel}</span>
        {a.expiresLabel && (
          <>
            <span>·</span>
            <span className={cn(!a.expired && a.expiresSoon && "text-warn")}>{a.expired ? "Expired" : "Expires"} <span className="num">{a.expiresLabel}</span></span>
          </>
        )}
      </footer>
      {error && <FormMessage tone="error" className="mt-2">{error}</FormMessage>}
    </article>
  );
}
