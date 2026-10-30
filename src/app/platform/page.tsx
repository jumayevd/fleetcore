import Link from "next/link";
import { ArrowRight, Building2, LogOut, MailPlus, ShieldCheck, Users } from "lucide-react";
import { rootDb } from "@/lib/db-root";
import { requirePlatformOwner } from "@/lib/platform";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { ago } from "@/lib/format";
import { openCompanyAsPlatform } from "@/app/actions/platform";
import { signOut } from "@/app/actions/auth";
import { Badge, Card, Chip, Stat, Table, buttonClass, cn } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { CompanyBadge } from "@/components/workspace-switcher";
import { Wordmark } from "@/components/brand";
import { ROLE_TONE } from "../(app)/admin/shared";
import { CompanyCreatorToggle, PasswordLinkButton } from "./controls";
import { NewCompanyForm } from "../select/forms";

export const metadata = { title: "Platform console" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Everything on FleetCore, for the people who run it (platform owners): every company with its size and activity,
 * every account with the companies it works in, open invitations. "Open" works in a company as its owner without
 * joining it; "Password link" lets someone set a new password (there is no email).
 */
export default async function PlatformPage() {
  const me = await requirePlatformOwner();
  const now = new Date();
  const [companies, openWork, activity, users, invites] = await Promise.all([
    rootDb.company.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, color: true, createdAt: true, units: true, timezone: true,
        _count: { select: { memberships: { where: { active: true } }, trucks: true, drivers: true, documents: true } },
        eldLinks: { select: { active: true, vehicles: true, lastSuccessAt: true, lastError: true } },
      },
    }),
    rootDb.workOrder.groupBy({ by: ["companyId"], where: { status: { in: ["DRAFT", "OPEN", "IN_PROGRESS"] } }, _count: true }),
    rootDb.auditLog.groupBy({ by: ["companyId"], where: { companyId: { not: null } }, _max: { createdAt: true } }),
    rootDb.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, email: true, active: true, platformRole: true, canCreateCompanies: true, lastLoginAt: true, createdAt: true,
        memberships: { where: { active: true }, orderBy: { company: { name: "asc" } }, select: { role: true, company: { select: { name: true } } } },
      },
    }),
    rootDb.invite.findMany({ where: { acceptedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" }, include: { company: { select: { name: true } }, invitedBy: { select: { name: true } } } }),
  ]);
  const open = new Map(openWork.map((r) => [r.companyId, r._count]));
  const lastSeen = new Map(activity.map((r) => [r.companyId!, r._max.createdAt]));
  const people = users.filter((u) => u.active);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/platform" aria-label="FleetCore"><Wordmark /></Link>
          <Chip tone="accent">Platform console</Chip>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle className="h-8 border border-line bg-surface px-2" />
          <span className="hidden text-[12px] text-fg-subtle sm:inline">{me.email}</span>
          <form action={signOut}>
            <input type="hidden" name="userId" value={me.id} />
            <button className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-fg-muted hover:bg-raised hover:text-fg"><LogOut className="h-3.5 w-3.5" />Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 pb-16 pt-6 lg:px-8">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-fg">Platform console</h1>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Every company and account on FleetCore. You belong to none of them: open a company to work in it as its owner. You don&apos;t show in its member list, and what you change is in its audit log under your name.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Companies" value={companies.length} icon={<Building2 />} />
          <Stat label="Accounts" value={people.length} icon={<Users />} hint="that can sign in" />
          <Stat label="Signed in this week" value={people.filter((u) => u.lastLoginAt && now.getTime() - u.lastLoginAt.getTime() < 7 * 86_400_000).length} icon={<ShieldCheck />} />
          <Stat label="Open invitations" value={invites.length} icon={<MailPlus />} tone={invites.length ? "info" : "neutral"} />
        </div>

        <Card flush title="Companies">
          <Table head={["Company", "Members", "Trucks", "Drivers", "Open repairs", "Documents", "TrackPro", "Last activity", ""]} empty={companies.length === 0}
            emptyTitle="No companies yet" emptyDescription="Create one below, or allow an account to create companies.">
            {companies.map((c) => {
              const eld = c.eldLinks[0];
              const seen = lastSeen.get(c.id);
              return (
                <tr key={c.id}>
                  <td className="min-w-56">
                    <div className="flex items-center gap-2.5">
                      <CompanyBadge name={c.name} color={c.color} size={28} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{c.name}</p>
                        <p className="text-[11px] text-fg-subtle">Since {day(c.createdAt)} · {c.units === "metric" ? "km" : "mi"} · {c.timezone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="num">{c._count.memberships}</td>
                  <td className="num">{c._count.trucks}</td>
                  <td className="num">{c._count.drivers}</td>
                  <td className="num">{open.get(c.id) ?? 0}</td>
                  <td className="num">{c._count.documents}</td>
                  <td className="whitespace-nowrap text-[12px]">
                    {!eld ? <span className="text-fg-faint">—</span>
                      : eld.lastError ? <Badge value="ERROR" tone="danger" label="Needs attention" dot />
                        : <span className="num">{eld.vehicles} trucks{eld.lastSuccessAt ? <span className="text-fg-subtle"> · {ago(eld.lastSuccessAt)}</span> : null}</span>}
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-fg-muted">{seen ? ago(seen) : "—"}</td>
                  <td className="w-24 text-right">
                    <form action={openCompanyAsPlatform}>
                      <input type="hidden" name="companyId" value={c.id} />
                      <button className={buttonClass("secondary", "sm")}>Open<ArrowRight /></button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        {/* Only you and the accounts you allow create companies; yours has no members until you invite its people. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NewCompanyForm userId={me.id} first={false} />
        </div>

        <Card flush title="Accounts">
          <Table head={["Person", "Companies", "Last sign-in", "Since", ""]} empty={users.length === 0}>
            {users.map((u) => (
              <tr key={u.id} className={cn(!u.active && "opacity-60")}>
                <td className="min-w-56">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-fg">{u.name}</span>
                    {u.platformRole && <Chip tone="accent">Platform owner</Chip>}
                    {!u.platformRole && u.canCreateCompanies && <Chip tone="info">Creates companies</Chip>}
                    {u.id === me.id && <Chip>You</Chip>}
                    {!u.active && <Chip>Switched off</Chip>}
                  </div>
                  <div className="truncate text-[12px] text-fg-subtle">{u.email}</div>
                </td>
                <td>
                  <div className="flex max-w-md flex-wrap gap-1">
                    {u.memberships.length ? u.memberships.map((m) => (
                      <Badge key={m.company.name} value={m.role} tone={isRole(m.role) ? ROLE_TONE[m.role] : "neutral"} label={`${m.company.name} · ${isRole(m.role) ? ROLE_LABELS[m.role] : m.role}`} />
                    )) : <span className="text-[12px] text-fg-faint">{u.platformRole ? "Every company, from here" : "None"}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap text-[12px]">{u.lastLoginAt ? ago(u.lastLoginAt) : <span className="text-fg-faint">never</span>}</td>
                <td className="whitespace-nowrap text-[12px] text-fg-muted">{day(u.createdAt)}</td>
                <td className="text-right">
                  {u.active && (
                    <span className="inline-flex items-start justify-end gap-1">
                      {!u.platformRole && <CompanyCreatorToggle userId={u.id} email={u.email} allowed={u.canCreateCompanies} />}
                      <PasswordLinkButton userId={u.id} email={u.email} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card flush title="Open invitations">
          <Table head={["Email", "Company", "Role", "Invited by", "Expires"]} empty={invites.length === 0}
            emptyTitle="No open invitations" emptyDescription="Invitations made under Settings → Members in a company show here until they are accepted.">
            {invites.map((i) => (
              <tr key={i.id}>
                <td className="font-medium text-fg">{i.email}</td>
                <td>{i.company.name}</td>
                <td>{isRole(i.role) ? <Badge value={i.role} tone={ROLE_TONE[i.role]} label={ROLE_LABELS[i.role]} /> : i.role}</td>
                <td className="text-[12px] text-fg-muted">{i.invitedBy?.name ?? "Set up for you"}</td>
                <td className="whitespace-nowrap text-[12px] text-fg-muted">{day(i.expiresAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </main>
    </div>
  );
}
