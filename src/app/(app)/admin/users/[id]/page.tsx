import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { ago, date, dateTime } from "@/lib/format";
import { updateUser } from "@/app/actions/people";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, Checkbox, Chip, DL, Field, InfoTip, Input, LinkButton, PageHeader, Select, Table } from "@/components/ui";
import { ROLE_TONE, TeamLabel } from "../../shared";
import { actionLabel, actionTone, entityHref, entityLabel } from "../../audit/links";

export async function generateMetadata({ params }: PageProps<"/admin/users/[id]">) {
  if (!(await getCurrentUser())) return {};
  const r = await db.user.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: r?.name ?? "Not found" };
}

export default async function EditUser({ params }: PageProps<"/admin/users/[id]">) {
  const me = await requireUser("users.manage");
  const { id } = await params;
  const [user, teams] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true, color: true } },
        driver: { select: { id: true, status: true } },
        audits: { orderBy: { createdAt: "desc" }, take: 20 },
        _count: { select: { dispatched: true, audits: true } },
      },
    }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!user) notFound();
  if (user.role === "OWNER" && me.role !== "OWNER") redirect("/admin/users");
  const self = user.id === me.id;
  const roleOptions = ROLES.filter((r) => r !== "OWNER" || me.role === "OWNER").map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/users" className="inline-flex items-center gap-1 hover:text-fg"><ArrowLeft className="h-3 w-3" />Users &amp; roles</Link>}
        title={<span className="inline-flex items-center gap-3"><Avatar name={user.name} size={28} />{user.name}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <span>{user.email}</span>
          <Badge value={user.role} tone={ROLE_TONE[user.role as Role] ?? "neutral"} label={ROLE_LABELS[user.role as Role] ?? user.role} />
          {user.active ? <Badge value="ACTIVE" label="Active" dot /> : <Badge value="INACTIVE" label="Disabled" />}
          {self && <Chip>You</Chip>}
        </span>}
        actions={<LinkButton href={`/admin/audit?user=${user.id}`} variant="secondary">Full activity</LinkButton>}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Account<InfoTip>The team groups the dispatch board. A new password needs at least 8 characters.</InfoTip></span>}>
            <ActionForm action={updateUser.bind(null, id)} className="space-y-3">
              <Field label="Name" required><Input name="name" defaultValue={user.name} required /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder="+998 90 000 00 00" className="num" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Role" hint={self ? "You can't change your own role." : undefined}>
                  <Select name="role" defaultValue={user.role} options={roleOptions} disabled={self} />
                </Field>
                <Field label="Team">
                  <Select name="teamId" defaultValue={user.teamId ?? ""} placeholder="No team" options={teams.map((t) => ({ value: t.id, label: t.name }))} />
                </Field>
              </div>
              {self && <input type="hidden" name="role" value={user.role} />}
              <Checkbox name="active" defaultChecked={user.active} disabled={self} label={<span>Account active <span className="text-fg-subtle">— can sign in</span></span>} />
              {self && <input type="hidden" name="active" value="on" />}
              <Field label="Reset password">
                <Input name="password" type="password" minLength={8} autoComplete="new-password" placeholder="Leave empty to keep the current one" />
              </Field>
              <SubmitButton className="w-full" pendingText="Saving…">Save changes</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Summary">
            <DL cols={2} items={[
              ["Team", <TeamLabel key="team" team={user.team} />],
              ["Member since", date(user.createdAt)],
              ["Last sign-in", user.lastLoginAt ? <span title={dateTime(user.lastLoginAt)}>{ago(user.lastLoginAt)}</span> : <span className="text-fg-faint">never</span>],
              ["Telegram", user.telegramChatId
                ? <span className="inline-flex items-center gap-1"><Send className="h-3 w-3 text-info" />{user.telegramAlerts ? "Linked, alerts on" : "Linked, alerts paused"}</span>
                : <span className="text-fg-faint">Not linked</span>],
              ["Loads dispatched", <span key="d" className="num">{user._count.dispatched}</span>],
              ["Driver profile", user.driver
                ? <Link href={`/drivers/${user.driver.id}`} className="hover:underline">Open profile</Link>
                : <span className="text-fg-faint">—</span>],
            ]} />
          </Card>
        </div>

        <Card title="Recent activity" className="xl:col-span-2" flush
          actions={
            <span className="num text-[11px] text-fg-subtle">
              {user._count.audits > user.audits.length
                ? <>Latest {user.audits.length} of {user._count.audits} · <Link href={`/admin/audit?user=${user.id}`} className="font-sans font-medium text-fg-muted hover:text-fg hover:underline">See all</Link></>
                : `${user._count.audits} entries`}
            </span>
          }>
          <Table head={["When", "Action", "Entity", "Details"]} empty={user.audits.length === 0}
            emptyTitle="No activity recorded" emptyDescription="Changes this person makes will show up here and in the audit log." dense>
            {user.audits.map((a) => {
              const href = entityHref(a.entity, a.entityId);
              return (
                <tr key={a.id}>
                  <td className="num whitespace-nowrap text-[12px] text-fg-muted">{dateTime(a.createdAt)}</td>
                  <td><Badge value={a.action} tone={actionTone(a.action)} label={actionLabel(a.action)} /></td>
                  <td className="whitespace-nowrap">{href ? <Link href={href} className="hover:underline">{entityLabel(a.entity)}</Link> : entityLabel(a.entity)}</td>
                  <td className="max-w-md truncate text-fg-muted" title={a.details ?? undefined}>{a.details ?? <span className="text-fg-faint">—</span>}</td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </>
  );
}
