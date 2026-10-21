"use client";

import { saveAnnouncement } from "@/app/actions/chat";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, Checkbox, Field, Input, Textarea } from "@/components/ui";
import type { AnnouncementDTO } from "./shared";

/** Create (no `a`) or edit an announcement. Owner / admin only — the page hides it for everyone else. */
export function AnnouncementForm({ a, onSaved, onCancel }: { a?: AnnouncementDTO; onSaved?: () => void; onCancel?: () => void }) {
  return (
    <ActionForm action={saveAnnouncement.bind(null, a?.id ?? null)} resetOnSuccess={!a} onSuccess={onSaved} className="space-y-3">
      <Field label="Title" required>
        <Input name="title" required maxLength={120} defaultValue={a?.title} placeholder="Short and specific — what changed, for whom" autoComplete="off" />
      </Field>
      <Field label="Body" required>
        <Textarea name="body" required rows={5} maxLength={5000} defaultValue={a?.body}
          placeholder="Details. Line breaks are kept; load references like LD-10102 and links become clickable." />
      </Field>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Expires (optional)" className="min-w-52 flex-1">
          <Input name="expiresAt" type="datetime-local" defaultValue={a?.expiresInput} />
        </Field>
        <Checkbox name="pinned" label="Pin to the top" defaultChecked={a?.pinned} className="h-8" />
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton pendingText={a ? "Saving…" : "Posting…"}>{a ? "Save changes" : "Post announcement"}</SubmitButton>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </ActionForm>
  );
}
