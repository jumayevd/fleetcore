"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteTeam, saveTeam } from "@/app/actions/people";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, Card, EmptyState, Field, IconButton, InfoTip, Input, Table, cn } from "@/components/ui";
import { TEAM_COLORS, TeamDot } from "../shared";

export type TeamRow = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  dispatchers: { id: string; name: string }[];
  driverCount: number;
  activeLoads: number;
};

/* ------------------------------------------------------------------ */
/* Colour picker: preset swatches + a native colour input              */
/* ------------------------------------------------------------------ */

function ColorField({ defaultValue }: { defaultValue: string | null }) {
  const [color, setColor] = useState(defaultValue ?? TEAM_COLORS[0]);
  return (
    <div>
      <span className="mb-1 block text-[12px] font-medium text-fg-muted">Colour</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {TEAM_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Use colour ${c}`} aria-pressed={color.toLowerCase() === c.toLowerCase()}
            className={cn("flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
              color.toLowerCase() === c.toLowerCase() ? "border-fg" : "border-transparent hover:border-line-strong")}>
            <span className="h-4 w-4 rounded-full" style={{ background: c }} />
          </button>
        ))}
        <label className="relative ml-1 inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 text-[11px] text-fg-muted hover:border-line-strong" title="Pick any colour">
          <TeamDot color={color} />
          <span className="num">{color.toUpperCase()}</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <input type="hidden" name="color" value={color} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit form (bound to saveTeam)                              */
/* ------------------------------------------------------------------ */

function TeamForm({ team, nextOrder, onDone }: { team?: TeamRow; nextOrder: number; onDone: () => void }) {
  const router = useRouter();
  return (
    <ActionForm action={saveTeam.bind(null, team?.id ?? null)} onSuccess={() => { router.refresh(); onDone(); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Team name" required><Input name="name" required defaultValue={team?.name} placeholder="Team Alpha" autoFocus /></Field>
        <Field label="Board order"><Input name="sortOrder" type="number" min={0} step={1} defaultValue={team?.sortOrder ?? nextOrder} className={cn("num", "w-20")} /></Field>
      </div>
      <ColorField defaultValue={team?.color ?? null} />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}><X />Cancel</Button>
        <SubmitButton size="sm" pendingText="Saving…">{team ? "Save team" : "Create team"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

/**
 * Dispatcher teams: who dispatches, how many drivers each team runs and how busy it is right now.
 * Edit opens an inline form under the row; delete asks first. Drivers, users and loads keep their
 * records when a team goes (the relation is set to null), they just become unassigned.
 */
export function TeamsPanel({ teams, editable }: { teams: TeamRow[]; editable: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextOrder = teams.length ? Math.max(...teams.map((t) => t.sortOrder)) + 1 : 0;

  const remove = (t: TeamRow) => {
    const who = [t.dispatchers.length ? `${t.dispatchers.length} dispatcher${t.dispatchers.length === 1 ? "" : "s"}` : null, t.driverCount ? `${t.driverCount} driver${t.driverCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
    const msg = `Delete ${t.name}?${who ? ` ${who} will be left without a team.` : ""} This can't be undone.`;
    if (!window.confirm(msg)) return;
    setError(null);
    start(async () => {
      try { await deleteTeam(t.id); router.refresh(); }
      catch (e) { setError(e instanceof Error && e.message ? e.message : `Could not delete ${t.name}`); }
    });
  };

  return (
    <Card flush
      title={
        <span className="flex items-center gap-1.5">Dispatcher teams
          <InfoTip>Teams group the dispatch board and the weekly production totals. Assign dispatchers under Users &amp; roles and drivers on their profile.</InfoTip>
        </span>
      }
      actions={editable && !creating && (
        <Button variant="secondary" size="sm" onClick={() => { setCreating(true); setEditing(null); }}><Plus />New team</Button>
      )}>
      {teams.length === 0 && !creating ? (
        <EmptyState title="No teams yet" description="Teams group dispatchers and their drivers on the daily and weekly boards. Create the first one to start grouping the board."
          action={editable && <Button size="sm" onClick={() => setCreating(true)}><Plus />New team</Button>} />
      ) : (
        <Table head={["Team", "Dispatchers", "Drivers", "Active loads", "Order", ""]} stickyHead={false} dense>
          {teams.map((t) => (
            <TeamRowView key={t.id} team={t} editable={editable} busy={pending} isEditing={editing === t.id}
              onEdit={() => { setEditing(t.id); setCreating(false); }} onCancel={() => setEditing(null)} onDelete={() => remove(t)} nextOrder={nextOrder} />
          ))}
        </Table>
      )}
      {creating && (
        <div className="border-t border-line bg-sunken/40 px-4 py-3">
          <p className="mb-2 text-[12px] font-medium text-fg">New team</p>
          <TeamForm nextOrder={nextOrder} onDone={() => setCreating(false)} />
        </div>
      )}
      {error && <p role="alert" className="border-t border-line bg-danger-soft px-4 py-2 text-[12px] text-danger">{error}</p>}
    </Card>
  );
}

function TeamRowView({ team: t, editable, busy, isEditing, onEdit, onCancel, onDelete, nextOrder }: {
  team: TeamRow; editable: boolean; busy: boolean; isEditing: boolean; onEdit: () => void; onCancel: () => void; onDelete: () => void; nextOrder: number;
}) {
  return (
    <>
      <tr className={cn(isEditing && "bg-raised")}>
        <td className="min-w-40">
          <span className="inline-flex items-center gap-2 font-medium text-fg"><TeamDot color={t.color} size={10} />{t.name}</span>
        </td>
        <td className="max-w-64">
          {t.dispatchers.length ? (
            <span className="block truncate text-fg" title={t.dispatchers.map((d) => d.name).join(", ")}>
              {t.dispatchers.map((d, i) => (
                <span key={d.id}>{i > 0 && <span className="text-fg-subtle">, </span>}<Link href={`/admin/users/${d.id}`} className="hover:underline">{d.name}</Link></span>
              ))}
            </span>
          ) : <span className="text-fg-faint">Nobody yet</span>}
        </td>
        <td className="num">{t.driverCount}</td>
        <td className={cn("num", !t.activeLoads && "text-fg-faint")}>{t.activeLoads}</td>
        <td className="num text-fg-muted">{t.sortOrder}</td>
        <td className="w-20">
          {editable && (
            <div className="flex items-center justify-end gap-0.5">
              <IconButton label={`Edit ${t.name}`} onClick={isEditing ? onCancel : onEdit} disabled={busy}>{isEditing ? <X /> : <Pencil />}</IconButton>
              <IconButton label={`Delete ${t.name}`} onClick={onDelete} disabled={busy} className="hover:bg-danger-soft hover:text-danger"><Trash2 /></IconButton>
            </div>
          )}
        </td>
      </tr>
      {isEditing && (
        <tr className="bg-raised hover:bg-raised">
          <td colSpan={6} className="border-t-0 px-4 pb-4 pt-1">
            <TeamForm team={t} nextOrder={nextOrder} onDone={onCancel} />
          </td>
        </tr>
      )}
    </>
  );
}
