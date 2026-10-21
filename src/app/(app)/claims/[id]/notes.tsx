import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Textarea } from "@/components/ui";
import { addClaimNote } from "@/app/actions/claims";

/** Pre-formatted on the server so no Date crosses the RSC boundary. */
export type NoteItem = { id: string; body: string; author: string; role: string | null; at: string; ago: string };

/** Notes thread: newest first, with a form to add one. Anyone who can see claims can write here. */
export function ClaimNotes({ claimId, notes, canPost }: { claimId: string; notes: NoteItem[]; canPost: boolean }) {
  return (
    <div>
      {canPost && (
        <ActionForm action={addClaimNote.bind(null, claimId)} resetOnSuccess className="border-b border-line p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Textarea name="body" required rows={2} maxLength={2000} aria-label="Note"
              placeholder="Adjuster called back, estimate received, driver statement attached…" className="flex-1" />
            <SubmitButton variant="secondary" pendingText="Adding…" className="sm:mt-0">Add note</SubmitButton>
          </div>
        </ActionForm>
      )}
      {notes.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-fg-muted">No notes yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-raised">
              <Avatar name={n.author} size={24} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-[13px] text-fg">{n.body}</p>
                <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
                  <span className="text-fg-muted">{n.author}</span>{n.role && ` · ${n.role}`} · <span className="num">{n.at}</span> · {n.ago}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
