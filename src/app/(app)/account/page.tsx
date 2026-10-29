import Link from "next/link";
import { Keyboard } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { rootDb } from "@/lib/db-root";
import { can } from "@/lib/permissions";
import { allNavItems } from "@/lib/nav";
import { ROLE_LABELS, isRole } from "@/lib/constants";
import { ago } from "@/lib/format";
import { getFormat } from "@/lib/format-server";
import { changePassword, updateProfile } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AppearanceControls } from "@/components/appearance";
import { CompanyBadge } from "@/components/workspace-switcher";
import { Avatar, Badge, Card, Chip, DL, Disclosure, Field, InfoTip, Input, Kbd, LinkButton, PageHeader, cardClass, cn } from "@/components/ui";
import { ROLE_TONE } from "../admin/shared";
import { LeaveCompanyButton } from "./leave";
import { ProfileFields } from "@/components/profile-fields";
import { birthDateValue, nameParts } from "@/lib/profile";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const me = await requireUser();
  const user = await rootDb.user.findUniqueOrThrow({
    where: { id: me.id },
    select: {
      name: true, email: true, phone: true, createdAt: true, lastLoginAt: true, firstName: true, lastName: true, idNumber: true, birthDate: true,
      memberships: { where: { active: true }, orderBy: { company: { name: "asc" } }, select: { id: true, role: true, createdAt: true, company: { select: { id: true, name: true, color: true } } } },
    },
  });
  const jumps = allNavItems().filter((i) => i.shortcut && can(me.role, i.perm));
  const { date, dateTime } = await getFormat();

  return (
    <>
      <PageHeader title="My account" subtitle={`${user.email} · signed in ${me.lastLoginAt ? ago(me.lastLoginAt) : "now"}`} />

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Profile<InfoTip>Your details are the same in every company you work for. Owners and admins of those companies see your ID number and date of birth.</InfoTip></span>}>
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={user.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-fg">{user.name}</p>
                <p className="truncate text-[12px] text-fg-muted">{user.email}</p>
              </div>
              <Badge value={me.role} tone={ROLE_TONE[me.role]} label={`${ROLE_LABELS[me.role]} here`} className="ml-auto" />
            </div>
            <ActionForm action={updateProfile} className="space-y-3">
              <ProfileFields required={me.role !== "OWNER"}
                defaults={{ ...nameParts(user), idNumber: user.idNumber, birthDate: birthDateValue(user.birthDate) }} />
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder="+998 90 000 00 00" className="num" autoComplete="tel" /></Field>
              <div className="flex items-center justify-between gap-3">
                <DL cols={2} items={[
                  ["Member since", date(user.createdAt)],
                  ["Last sign-in", user.lastLoginAt ? <span key="l" title={dateTime(user.lastLoginAt)}>{ago(user.lastLoginAt)}</span> : "now"],
                ]} />
                <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card flush title={<span className="flex items-center gap-1.5">Your companies<InfoTip>Companies this account belongs to. Other accounts you are signed in to are under All companies in the account menu (top right).</InfoTip></span>}
            actions={<LinkButton href="/select" variant="ghost" size="sm">All companies</LinkButton>}>
            <ul className="divide-y divide-line">
              {user.memberships.map((m) => {
                const current = m.company.id === me.company.id;
                const role = isRole(m.role) ? m.role : "SPECIALIST";
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                    <CompanyBadge name={m.company.name} color={m.company.color} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg">{m.company.name}{current && <Chip tone="accent">Current</Chip>}</p>
                      <p className="text-[11px] text-fg-subtle">{ROLE_LABELS[role]} · joined {date(m.createdAt)}</p>
                    </div>
                    {current && <LeaveCompanyButton company={m.company.name} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Change password<InfoTip>One password for this account in every company. Other accounts you are signed in to keep their own.</InfoTip></span>}>
            <ActionForm action={changePassword} resetOnSuccess className="space-y-3">
              <Field label="Current password" required><Input name="current" type="password" required autoComplete="current-password" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New password" required><Input name="next" type="password" minLength={8} required autoComplete="new-password" placeholder="At least 8 characters" /></Field>
                <Field label="Confirm new password" required><Input name="confirm" type="password" minLength={8} required autoComplete="new-password" /></Field>
              </div>
              <SubmitButton pendingText="Updating…">Update password</SubmitButton>
            </ActionForm>
          </Card>

          <Card title={<span className="flex items-center gap-1.5">Appearance<InfoTip>Choices are saved in this browser and apply instantly. The same panel is behind the palette icon in the top bar.</InfoTip></span>}>
            <AppearanceControls />
          </Card>
        </div>

        {/* Reference: closed until asked for. */}
        <section className={cn(cardClass, "h-fit lg:col-span-2 2xl:col-span-1")}>
          <Disclosure title="Keyboard shortcuts" icon={<Keyboard />} tone="neutral" className="[&>summary]:rounded-lg [&>summary]:py-3">
            <ul className="divide-y divide-line border-t border-line text-[12px]">
              <Shortcut keys={[["⌘", "K"], ["Ctrl", "K"]]} sep="or">Open search and commands from anywhere</Shortcut>
              <Shortcut keys={[["/"]]}>Open search (when not typing in a field)</Shortcut>
              <Shortcut keys={[["Alt", "1"], ["Alt", "9"]]} sep="…">Switch to company 1 to 9, in the order All companies lists them</Shortcut>
              <Shortcut keys={[["↑"], ["↓"]]} sep="">Move through results</Shortcut>
              <Shortcut keys={[["↵"]]}>Open the highlighted result</Shortcut>
              <Shortcut keys={[["esc"]]}>Close search, menus and drawers</Shortcut>
            </ul>
            <div className="border-t border-line bg-sunken/40 px-4 py-2">
              <p className="text-[11px] text-fg-subtle">Press <Kbd>g</Kbd> then a letter to jump.</p>
            </div>
            <ul className="grid grid-cols-1 divide-y divide-line text-[12px] sm:grid-cols-2 sm:divide-y-0 sm:[&>li:nth-child(n+3)]:border-t sm:[&>li]:border-line">
              {jumps.map((i) => {
                const [g, letter] = i.shortcut!.split(" ");
                return (
                  <li key={i.href} className="flex items-center justify-between gap-3 px-4 py-1.5">
                    <Link href={i.href} className="truncate text-fg hover:underline">{i.label}</Link>
                    <span className="flex shrink-0 items-center gap-0.5"><Kbd>{g}</Kbd><Kbd>{letter}</Kbd></span>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        </section>
      </div>
    </>
  );
}

function Shortcut({ keys, sep = "", children }: { keys: string[][]; sep?: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="text-fg">{children}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((combo, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && sep && <span className="text-[11px] text-fg-subtle">{sep}</span>}
            <span className="flex items-center gap-0.5">{combo.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
          </span>
        ))}
      </span>
    </li>
  );
}
