import { headers } from "next/headers";
import { KeyRound, LogIn, MailPlus, ShieldCheck, UserCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { rootDb } from "@/lib/db-root";
import { assignableRoles } from "@/lib/permissions";
import { birthDateLabel } from "@/lib/profile";
import { domainsText, memberDomains } from "@/lib/member-domains";
import { ROLES, ROLE_HINTS, ROLE_LABELS, isRole } from "@/lib/constants";
import { ago, daysAgo } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { inviteMember } from "@/app/actions/members";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Chip, Disclosure, Field, InfoTip, Input, PageHeader, Select, Stat, Table, cardClass, cn } from "@/components/ui";
import { ROLE_TONE } from "../shared";
import { CopyInviteLink, MemberRole, RemoveMember, RevokeInvite } from "./controls";

export const metadata = { title: "Members" };

/** Base URL for invitation links: APP_URL when set, else the host this page was served from. */
async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function MembersPage() {
  const me = await requireUser("members.manage");
  const companyId = me.company.id;
  const [members, invites, base, { date }] = await Promise.all([
    rootDb.membership.findMany({
      where: { companyId, active: true },
      include: { user: { select: { id: true, name: true, email: true, phone: true, lastLoginAt: true, idNumber: true, birthDate: true } } },
    }),
    rootDb.invite.findMany({ where: { companyId, acceptedAt: null }, orderBy: { createdAt: "desc" }, include: { invitedBy: { select: { name: true } } } }),
    origin(),
    getFormat(),
  ]);
  const domains = memberDomains();
  const rank = (r: string) => ROLES.indexOf(r as (typeof ROLES)[number]);
  const rows = members.sort((a, b) => rank(a.role) - rank(b.role) || a.user.name.localeCompare(b.user.name));
  const now = new Date();
  const open = invites.filter((i) => i.expiresAt > now);
  const admins = rows.filter((m) => m.role === "OWNER" || m.role === "ADMIN").length;
  const recent = rows.filter((m) => m.lastActiveAt && m.lastActiveAt >= daysAgo(7)).length;
  const grantable = assignableRoles(me.role);

  return (
    <>
      <PageHeader title="Members" subtitle={`Who works in ${me.company.name}, and what they can do here`} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Members" value={rows.length} icon={<UserCheck />} tone="ok" hint="people with access to this company" />
        <Stat label="Active this week" value={recent} icon={<LogIn />} hint="opened this company in the last 7 days" />
        <Stat label="Owners & admins" value={admins} icon={<ShieldCheck />} tone={admins > 4 ? "warn" : "neutral"} hint="can manage members and the company profile" />
        <Stat label="Open invitations" value={open.length} icon={<MailPlus />} tone={open.length ? "info" : "neutral"} hint="links waiting to be accepted" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card flush>
            <Table head={["Name", "ID · Date of birth", "Role", "Joined", "Last here", ""]}>
              {rows.map((m) => {
                const role = isRole(m.role) ? m.role : "SPECIALIST";
                const self = m.id === me.membershipId;
                const editable = !self && (role !== "OWNER" || me.role === "OWNER");
                return (
                  <tr key={m.id}>
                    <td className="min-w-56">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-fg">{m.user.name}</span>
                        {self && <Chip>You</Chip>}                      </div>
                      <div className="truncate text-[12px] text-fg-subtle" title={m.user.phone ?? undefined}>{m.user.email}</div>
                    </td>
                    <td className="whitespace-nowrap text-[12px]">
                      {m.user.idNumber || m.user.birthDate ? (
                        <>
                          <div className="num text-fg">{m.user.idNumber ?? <span className="text-fg-faint">No ID number</span>}</div>
                          <div className="num text-fg-subtle">{m.user.birthDate ? birthDateLabel(m.user.birthDate) : "No date of birth"}</div>
                        </>
                      ) : <span className="text-fg-faint">{role === "OWNER" ? "—" : "Not given yet"}</span>}
                    </td>
                    <td>
                      {editable
                        ? <MemberRole membershipId={m.id} role={role} options={grantable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
                        : <Badge value={role} tone={ROLE_TONE[role]} label={ROLE_LABELS[role]} />}
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-fg-muted">{date(m.createdAt)}</td>
                    <td className="whitespace-nowrap text-[12px]">
                      <span className={cn(!m.lastActiveAt && "text-fg-faint")}>{m.lastActiveAt ? ago(m.lastActiveAt) : "not yet"}</span>
                    </td>
                    <td className="w-24 text-right">{editable && <RemoveMember membershipId={m.id} name={m.user.name} company={me.company.name} />}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          {invites.length > 0 && (
            <Card flush title="Invitations" actions={<span className="text-[11px] text-fg-subtle">Links work once, for the invited email</span>}>
              <Table dense stickyHead={false} head={["Email", "Role", "Invited", "Expires", ""]}>
                {invites.map((i) => {
                  const expired = i.expiresAt <= now;
                  const role = isRole(i.role) ? i.role : "SPECIALIST";
                  return (
                    <tr key={i.id} className={cn(expired && "text-fg-muted")}>
                      <td className="font-medium">{i.email}</td>
                      <td><Badge value={role} tone={ROLE_TONE[role]} label={ROLE_LABELS[role]} /></td>
                      <td className="whitespace-nowrap text-[12px] text-fg-muted">{ago(i.createdAt)}{i.invitedBy ? ` · ${i.invitedBy.name}` : ""}</td>
                      <td className="whitespace-nowrap text-[12px]">{expired ? <Badge value="EXPIRED" tone="danger" label="Expired" /> : date(i.expiresAt)}</td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1">
                          {!expired && <CopyInviteLink url={`${base}/invite/${i.token}`} />}
                          <RevokeInvite inviteId={i.id} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}

          <section className={cardClass}>
            <Disclosure title="What each role can do" icon={<KeyRound />} className="[&>summary]:rounded-lg [&>summary]:py-3"
              meta={<InfoTip>Roles are per company: the same person can be an owner in one company and view-only in another.</InfoTip>}>
              <ul className="divide-y divide-line border-t border-line">
                {ROLES.map((r) => (
                  <li key={r} className="flex items-center gap-3 px-4 py-2">
                    <Badge value={r} tone={ROLE_TONE[r]} label={ROLE_LABELS[r]} className="w-32 justify-center" />
                    <span className="text-[12px] text-fg-muted">{ROLE_HINTS[r]}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </section>
        </div>

        <Card className="h-fit" title={
          <span className="flex items-center gap-1.5">Invite someone
            <InfoTip>They get a link to join {me.company.name}. If they already use FleetCore for another company, the same account works here too.</InfoTip>
          </span>
        }>
          <ActionForm action={inviteMember} resetOnSuccess className="space-y-3">
            <Field label="Email" required hint={domains.length ? `${domainsText(domains)} addresses only.` : undefined}>
              <Input name="email" type="email" required placeholder={`name@${domains[0] ?? "company.com"}`} />
            </Field>
            <Field label="Role" required hint={ROLE_HINTS.SPECIALIST}>
              <Select name="role" required defaultValue="SPECIALIST" options={grantable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
            </Field>
            <SubmitButton className="w-full" pendingText="Creating link…">Create invitation link</SubmitButton>
            <p className="text-[11px] text-fg-subtle">FleetCore doesn&apos;t send email: copy the link from Invitations and share it the way your team talks.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
