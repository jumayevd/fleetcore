import Link from "next/link";
import { Keyboard } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { allNavItems } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { ago, date, dateTime } from "@/lib/format";
import { changePassword } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AppearanceControls } from "@/components/appearance";
import { Avatar, Badge, Card, DL, Disclosure, Field, InfoTip, Input, Kbd, PageHeader, cardClass, cn } from "@/components/ui";
import { ROLE_TONE, TeamLabel } from "../admin/shared";
import { TelegramCard } from "./telegram-card";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const me = await requireUser();
  const user = await db.user.findUniqueOrThrow({
    where: { id: me.id },
    select: { name: true, email: true, phone: true, role: true, createdAt: true, lastLoginAt: true, team: { select: { id: true, name: true, color: true } }, driver: { select: { id: true } } },
  });
  const jumps = allNavItems().filter((i) => i.shortcut && can(me.role, i.perm));

  return (
    <>
      <PageHeader eyebrow="You" title="My account" />

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Profile<InfoTip>Name, role and team are managed by an administrator under Users &amp; roles.</InfoTip></span>}>
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={user.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-fg">{user.name}</p>
                <p className="truncate text-[12px] text-fg-muted">{user.email}</p>
              </div>
              <Badge value={user.role} tone={ROLE_TONE[user.role as Role] ?? "neutral"} label={ROLE_LABELS[user.role as Role] ?? user.role} className="ml-auto" />
            </div>
            <DL cols={2} items={[
              ["Team", <TeamLabel key="team" team={user.team} />],
              ["Phone", user.phone ? <span className="num">{user.phone}</span> : <span className="text-fg-faint">—</span>],
              ["Member since", date(user.createdAt)],
              ["Last sign-in", user.lastLoginAt ? <span title={dateTime(user.lastLoginAt)}>{ago(user.lastLoginAt)}</span> : "now"],
              ...(user.driver ? [["Driver profile", <Link key="d" href={`/drivers/${user.driver.id}`} className="hover:underline">Open</Link>] as [string, React.ReactNode]] : []),
            ]} />
          </Card>

          <TelegramCard userId={me.id} />
        </div>

        <div className="space-y-4">
          <Card title="Change password">
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
              <Shortcut keys={[["↑"], ["↓"]]} sep="">Move through results</Shortcut>
              <Shortcut keys={[["↵"]]}>Open the highlighted result</Shortcut>
              <Shortcut keys={[["esc"]]}>Close search, menus and drawers</Shortcut>
            </ul>
            <div className="border-t border-line bg-sunken/40 px-4 py-2">
              <p className="text-[11px] text-fg-subtle">Press <Kbd>g</Kbd> then a letter to jump. Only pages your role can open are listed.</p>
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
              {jumps.length === 0 && <li className="px-4 py-3 text-fg-subtle">No jump shortcuts for your role.</li>}
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
