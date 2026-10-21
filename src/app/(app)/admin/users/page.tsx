import Link from "next/link";
import { Check, KeyRound, LogIn, Pencil, Send, ShieldCheck, UserCheck, Users } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { ago, daysAgo } from "@/lib/format";
import { createUser } from "@/app/actions/people";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Chip, Disclosure, Field, FilterPills, InfoTip, Input, LinkButton, PageHeader, Select, Stat, Table, cardClass, cn } from "@/components/ui";
import { ROLE_TONE, TeamLabel } from "../shared";

export const metadata = { title: "Users & roles" };

/* Permission labels and the area each belongs to, for the matrix. */
const PERM_LABELS: Record<Permission, string> = {
  "dashboard.view": "Overview dashboard", "loads.view": "View loads", "loads.edit": "Create and dispatch loads", "board.edit": "Edit the dispatch board",
  "tracking.view": "Live map", "fleet.view": "View trucks and trailers", "fleet.edit": "Manage fleet and maintenance",
  "drivers.view": "View drivers", "drivers.edit": "Manage drivers", "customers.view": "View customers and brokers", "customers.edit": "Manage customers and brokers",
  "finance.view": "View finance", "finance.edit": "Invoices and payments", "reports.view": "Reports", "claims.view": "View claims", "claims.edit": "Manage claims",
  "chat.view": "Chat and announcements", "announcements.manage": "Post announcements", "assistant.use": "Fleet assistant",
  "company.manage": "Company profile", "users.manage": "Users, teams and Telegram", "audit.view": "Audit log", "driver.portal": "Driver app",
};
const AREA_LABELS: Record<string, string> = {
  dashboard: "Dispatch", loads: "Dispatch", board: "Dispatch", tracking: "Dispatch", fleet: "Fleet", drivers: "People", customers: "People",
  finance: "Money", reports: "Money", claims: "Safety", chat: "Team", announcements: "Team", assistant: "Team", company: "Company", users: "Company", audit: "Company", driver: "Driver",
};
const AREA_ORDER = ["Dispatch", "Fleet", "People", "Money", "Safety", "Team", "Company", "Driver"];

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireUser("users.manage");
  const sp = await searchParams;
  const role = typeof sp.role === "string" && (ROLES as readonly string[]).includes(sp.role) ? (sp.role as Role) : undefined;
  const showDisabled = sp.disabled === "1";

  const [all, teams] = await Promise.all([
    db.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, phone: true, role: true, active: true, lastLoginAt: true, createdAt: true, telegramChatId: true, telegramAlerts: true, team: { select: { id: true, name: true, color: true } }, driver: { select: { id: true } } },
    }),
    db.team.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  const roleRank = (r: string) => ROLES.indexOf(r as Role);
  const users = all
    .filter((u) => (role ? u.role === role : true) && (showDisabled || u.active))
    .sort((a, b) => Number(b.active) - Number(a.active) || roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));

  const active = all.filter((u) => u.active);
  const staff = active.filter((u) => u.role !== "DRIVER");
  const disabled = all.length - active.length;
  const linked = active.filter((u) => u.telegramChatId).length;
  const recent = active.filter((u) => u.lastLoginAt && u.lastLoginAt >= daysAgo(7)).length;
  const never = active.filter((u) => !u.lastLoginAt).length;
  const admins = active.filter((u) => u.role === "OWNER" || u.role === "ADMIN").length;

  const qs = (patch: { role?: string; disabled?: string }) => {
    const p = new URLSearchParams();
    const next = { role: role as string | undefined, disabled: showDisabled ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/users${s ? `?${s}` : ""}`;
  };
  const countFor = (r: Role) => all.filter((u) => u.role === r && (showDisabled || u.active)).length;
  // Empty table: say whether the toggle is hiding disabled accounts or the role simply has nobody yet.
  const hiddenDisabled = showDisabled ? 0 : all.filter((u) => !u.active && (!role || u.role === role)).length;
  const roleName = role ? ROLE_LABELS[role].toLowerCase() : null;
  const empty = hiddenDisabled
    ? { title: roleName ? `No active ${roleName} accounts` : "No active accounts", description: `${hiddenDisabled} disabled ${hiddenDisabled === 1 ? "account is" : "accounts are"} hidden. Use Show disabled to include them.` }
    : { title: roleName ? `No ${roleName} accounts yet` : "No accounts yet", description: role === "DRIVER" ? "Driver logins are created from Drivers → Add driver, so each one is tied to a driver profile." : "Create one with Add a team member." };
  const roleOptions = ROLES.filter((r) => r !== "OWNER" || me.role === "OWNER").map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  const perms = (Object.keys(PERMISSIONS) as Permission[]).map((p) => ({ key: p, area: AREA_LABELS[p.split(".")[0]] ?? "Other" }));
  const areas = AREA_ORDER.filter((a) => perms.some((p) => p.area === a));

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title="Users & roles"
        actions={<LinkButton href="/admin/company" variant="secondary"><Users />Teams</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active accounts" value={active.length} hint={`${staff.length} staff · ${active.length - staff.length} driver logins · ${disabled ? `${disabled} disabled` : "none disabled"}`} icon={<UserCheck />} tone="ok" />
        <Stat label="Signed in this week" value={recent} hint={never ? `${never} never signed in` : "everyone has signed in at least once"} icon={<LogIn />} tone={never ? "warn" : "neutral"} />
        <Stat label="Telegram linked" value={`${linked}/${active.length}`} hint={linked < active.length ? "ask the rest to connect under My account" : "everyone gets alerts"} icon={<Send />} tone={linked ? "info" : "neutral"} />
        <Stat label="Admin rights" value={admins} hint="owner and administrator accounts" icon={<ShieldCheck />} tone={admins > 3 ? "warn" : "neutral"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FilterPills active={role ?? "all"} items={[
              { key: "all", href: qs({ role: undefined }), label: "All", count: all.filter((u) => showDisabled || u.active).length },
              ...ROLES.map((r) => ({ key: r, href: qs({ role: r }), label: ROLE_LABELS[r], count: countFor(r) })),
            ]} />
            <Link href={qs({ disabled: showDisabled ? undefined : "1" })}
              className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-colors",
                showDisabled ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg")}>
              {showDisabled && <Check className="h-3 w-3" />}Show disabled{disabled > 0 && <span className={cn("num text-[10px]", showDisabled ? "opacity-70" : "text-fg-subtle")}>{disabled}</span>}
            </Link>
          </div>

          <Card flush>
            <Table head={["Name", "Role", "Team", "Status", "Telegram", "Last sign-in", ""]}
              empty={users.length === 0} emptyTitle={empty.title} emptyDescription={empty.description}>
              {users.map((u) => {
                const canEdit = u.role !== "OWNER" || me.role === "OWNER";
                return (
                  <tr key={u.id} className={cn(!u.active && "text-fg-muted")}>
                    <td className="min-w-52" title={[u.email, u.phone].filter(Boolean).join(" · ")}>
                      <span className="inline-flex items-center gap-1.5">
                        {canEdit ? <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.name}</Link> : <span className="font-medium">{u.name}</span>}
                        {u.id === me.id && <Chip>You</Chip>}
                        {u.driver && <Chip tone="info" title="Linked to a driver profile">Driver</Chip>}
                      </span>
                    </td>
                    <td><Badge value={u.role} tone={ROLE_TONE[u.role as Role] ?? "neutral"} label={ROLE_LABELS[u.role as Role] ?? u.role} /></td>
                    <td className="text-[12px]"><TeamLabel team={u.team} /></td>
                    <td>{u.active ? <Badge value="ACTIVE" label="Active" dot /> : <Badge value="INACTIVE" label="Disabled" />}</td>
                    <td className="text-[12px]">
                      {u.telegramChatId
                        ? <span className={cn("inline-flex items-center gap-1", u.telegramAlerts ? "text-fg" : "text-fg-muted")}><Send className="h-3 w-3 text-info" />{u.telegramAlerts ? "Linked" : "Paused"}</span>
                        : <span className="text-fg-faint">Not linked</span>}
                    </td>
                    <td className="whitespace-nowrap text-[12px]">
                      <span className={cn(!u.lastLoginAt && "text-fg-faint")} title={u.lastLoginAt ? u.lastLoginAt.toISOString() : undefined}>{u.lastLoginAt ? ago(u.lastLoginAt) : "never"}</span>
                    </td>
                    <td className="w-16 text-right">
                      {canEdit && <LinkButton href={`/admin/users/${u.id}`} variant="ghost" size="sm" aria-label={`Edit ${u.name}`}><Pencil />Edit</LinkButton>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          {/* Reference, not daily work: closed until asked for. */}
          <section className={cardClass}>
            <Disclosure title="What each role can do" icon={<KeyRound />} className="[&>summary]:rounded-lg [&>summary]:py-3"
              meta={<InfoTip>Defined in code; ask engineering to change a role.</InfoTip>}>
              <div className="overflow-auto border-t border-line">
                <table className="w-full min-w-max text-[12px]">
                  <thead>
                    <tr className="bg-surface text-left text-[12px] font-medium text-fg-muted">
                      <th className="border-b border-line px-4 py-2 font-medium">Permission</th>
                      {ROLES.map((r) => <th key={r} className="border-b border-line px-2 py-2 text-center font-medium">{ROLE_LABELS[r]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {areas.map((area) => (
                      <AreaRows key={area} area={area} perms={perms.filter((p) => p.area === area).map((p) => p.key)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          </section>
        </div>

        <Card className="h-fit" title={
          <span className="flex items-center gap-1.5">Add a team member
            <InfoTip>They sign in with this email. The team groups dispatchers on the board. Ask them to change the temporary password after the first sign-in.</InfoTip>
          </span>
        }>
          <ActionForm action={createUser} resetOnSuccess className="space-y-3">
            <Field label="Full name" required><Input name="name" required placeholder="As it should appear on the board" /></Field>
            <Field label="Email" required><Input name="email" type="email" required placeholder="name@company.uz" /></Field>
            <Field label="Phone"><Input name="phone" type="tel" placeholder="+998 90 000 00 00" className="num" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role" required><Select name="role" required defaultValue="DISPATCHER" options={roleOptions} /></Field>
              <Field label="Team"><Select name="teamId" placeholder="No team" options={teams.map((t) => ({ value: t.id, label: t.name }))} /></Field>
            </div>
            <Field label="Temporary password" required>
              <Input name="password" type="password" minLength={8} required autoComplete="new-password" placeholder="At least 8 characters" />
            </Field>
            <SubmitButton className="w-full" pendingText="Creating…">Create account</SubmitButton>
            <p className="text-[11px] text-fg-subtle">
              Drivers get their login from <Link href="/drivers/new" className="text-fg-muted hover:text-fg hover:underline">Drivers → Add driver</Link>, so the account is tied to their profile and trips.
            </p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function AreaRows({ area, perms }: { area: string; perms: Permission[] }) {
  return (
    <>
      <tr>
        <td colSpan={ROLES.length + 1} className="border-b border-line bg-raised/60 px-4 pb-1 pt-2"><span className="eyebrow">{area}</span></td>
      </tr>
      {perms.map((p) => (
        <tr key={p} className="border-b border-line last:border-b-0 hover:bg-raised">
          <td className="px-4 py-1.5 text-fg">{PERM_LABELS[p] ?? p}</td>
          {ROLES.map((r) => {
            const ok = (PERMISSIONS[p] as readonly string[]).includes(r);
            const label = `${ROLE_LABELS[r]}: ${ok ? "allowed" : "not allowed"}`;
            return (
              <td key={r} className="px-2 py-1.5 text-center">
                <span role="img" aria-label={label} title={label}
                  className={cn("inline-block h-2 w-2 rounded-full", ok ? "bg-ok" : "border border-line")} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
