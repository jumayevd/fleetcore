import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Banknote, BellRing, ClipboardList, ListChecks, PackageCheck, Paperclip, Sun, Terminal, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { getBot, getWebhookInfo, telegramConfigured } from "@/lib/telegram";
import { SETTING_GROUP_CHAT, SETTING_GROUP_CODE } from "@/lib/notify";
import { disconnectGroup, newGroupCode, registerWebhook, sendDigestNow } from "@/app/actions/telegram";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Disclosure, InfoTip, PageHeader, Table, buttonClass, cardClass, cn, type Tone } from "@/components/ui";
import { ROLE_TONE } from "../shared";
import { ConfirmSubmit } from "../confirm-submit";

export const metadata = { title: "Telegram alerts" };

const Code = ({ children, className }: { children: ReactNode; className?: string }) => (
  <code className={cn("num rounded bg-sunken px-1 py-0.5 text-[12px] text-fg", className)}>{children}</code>
);

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn("num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        done ? "bg-ok-soft text-ok" : "bg-primary text-on-primary")}>{n}</span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-medium text-fg">{title}</p>
        <div className="mt-1 space-y-2 text-[12px] leading-5 text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

function StatusTile({ label, tone, value, hint }: { label: string; tone: Tone; value: string; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="eyebrow">{label}</p>
      <div className="mt-1.5"><Badge value={label} tone={tone} label={value} dot /></div>
      {hint && <p className="mt-1.5 truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

const SENT: { icon: ReactNode; what: string; who: string }[] = [
  { icon: <AlertTriangle />, what: "Driver-reported issue", who: "dispatch, admins, group" },
  { icon: <PackageCheck />, what: "Pickup, delivery or cancellation", who: "dispatch, group · billing on delivery" },
  { icon: <ClipboardList />, what: "New trip assigned", who: "the driver" },
  { icon: <Paperclip />, what: "POD, CMR or customs uploaded", who: "dispatch and billing" },
  { icon: <Banknote />, what: "Invoice paid", who: "owner and accountants" },
  { icon: <Wrench />, what: "Truck into or out of the shop", who: "fleet and dispatch" },
  { icon: <Sun />, what: "Daily brief at 08:00 Tashkent", who: "management, group" },
];

export default async function TelegramAdmin() {
  await requireUser("users.manage");
  const configured = telegramConfigured();
  const [bot, hook, settings, linked, total] = await Promise.all([
    configured ? getBot().catch(() => null) : null,
    configured ? getWebhookInfo().catch(() => null) : null,
    db.appSetting.findMany({ where: { key: { in: [SETTING_GROUP_CHAT, SETTING_GROUP_CODE] } } }),
    // Active accounts only, like the total and like notify.ts: a disabled account gets no alerts.
    db.user.findMany({ where: { active: true, telegramChatId: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, telegramAlerts: true } }),
    db.user.count({ where: { active: true } }),
  ]);
  const group = settings.find((s) => s.key === SETTING_GROUP_CHAT)?.value;
  const groupCode = settings.find((s) => s.key === SETTING_GROUP_CODE)?.value;
  const paused = linked.filter((u) => !u.telegramAlerts).length;
  // The group chat is optional, so setup counts as done once the bot, the webhook and one person are connected.
  const setupDone = [Boolean(bot), Boolean(hook?.url), linked.length > 0];
  const setupComplete = setupDone.every(Boolean);

  const botTile = !configured ? { tone: "neutral" as Tone, value: "Not configured", hint: "Set TELEGRAM_BOT_TOKEN" }
    : bot ? { tone: "ok" as Tone, value: `@${bot.username}`, hint: "Token valid, bot reachable" }
    : { tone: "danger" as Tone, value: "Unreachable", hint: "Token set but Telegram rejects it" };
  const hookTile = !configured ? { tone: "neutral" as Tone, value: "Waiting for bot", hint: undefined }
    : hook?.url ? { tone: hook.last_error_message ? ("warn" as Tone) : ("ok" as Tone), value: "Connected", hint: hook.url }
    : { tone: "warn" as Tone, value: "Not connected", hint: "Links and commands won't reach the app" };
  const groupTile = group ? { tone: "ok" as Tone, value: "Connected", hint: "Receives all operations alerts" }
    : groupCode ? { tone: "info" as Tone, value: "Code issued", hint: "Send /connect in the group" }
    : { tone: "neutral" as Tone, value: "Not connected", hint: "Optional" };

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title="Telegram alerts"
        subtitle="Push operational alerts to your team's phones and to a company group chat."
        actions={<Link href="/account" className={buttonClass("secondary")}>Connect my account</Link>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusTile label="Bot" {...botTile} />
        <StatusTile label="Webhook" {...hookTile} />
        <StatusTile label="Group chat" {...groupTile} />
        <StatusTile label="Linked people" tone={linked.length ? "info" : "neutral"} value={`${linked.length} of ${total}`} hint={paused ? `${paused} paused their alerts` : linked.length ? "all receiving alerts" : "nobody has connected yet"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Open until the essentials work; afterwards the steps fold away but stay one click from the controls. */}
          <section className={cardClass}>
            <Disclosure title="Setup" icon={<ListChecks />} tone={setupComplete ? "ok" : "accent"} open={!setupComplete}
              className="[&>summary]:rounded-lg [&>summary]:py-3"
              meta={<span className="num text-[12px] text-fg-subtle">{setupDone.filter(Boolean).length} of {setupDone.length} done{group ? " · group on" : ""}</span>}>
              <ol className="space-y-5 border-t border-line px-4 py-4">
                <Step n={1} title="Create the bot" done={Boolean(bot)}>
                  <p>In Telegram, message <b className="font-medium text-fg">@BotFather</b> and send <Code>/newbot</Code>. Put the token in the <Code>TELEGRAM_BOT_TOKEN</Code> environment variable and redeploy.</p>
                  <div>{configured
                    ? bot ? <Badge value="ACTIVE" tone="ok" label={`Connected as @${bot.username}`} dot /> : <Badge value="CANCELLED" tone="danger" label="Token set but bot unreachable" />
                    : <Badge value="PLANNED" label="Not configured" />}</div>
                </Step>
  
                <Step n={2} title="Connect the webhook" done={Boolean(hook?.url)}>
                  <p>Lets the bot receive <Code>/start</Code> links and commands. Run this from the deployed site, not from localhost.</p>
                  {configured && (
                    <div className="space-y-2">
                      {hook?.url
                        ? <p className="num break-all text-[11px] text-ok">{hook.url}</p>
                        : <p className="text-[11px] text-warn">Not connected yet</p>}
                      {hook?.last_error_message && <p className="text-[11px] text-danger">Last error: {hook.last_error_message}</p>}
                      <ActionForm action={registerWebhook}><SubmitButton size="sm" variant="secondary" pendingText="Connecting…">{hook?.url ? "Reconnect webhook" : "Connect webhook"}</SubmitButton></ActionForm>
                    </div>
                  )}
                </Step>
  
                <Step n={3} title="Each person links their account" done={linked.length > 0}>
                  <p>Everyone opens <Link href="/account" className="font-medium text-fg hover:underline">My account → Connect Telegram</Link>. They then get alerts for their role: drivers get new trips, dispatchers get issues and status changes, accountants get PODs and payments.</p>
                </Step>
  
                <Step n={4} title="Optional: company group chat" done={Boolean(group)}>
                  <p>Add <Code>@{bot?.username ?? "your_bot"}</Code> to a group, then send the command below in that group. The group receives all operations alerts and the daily brief.</p>
                  <div className="space-y-2">
                    {group ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge value="ACTIVE" tone="ok" label="Group connected" dot />
                        <form action={disconnectGroup}>
                          <ConfirmSubmit confirm="Disconnect the group chat? It stops getting alerts until someone sends a new connect code there." className={cn(buttonClass("ghost", "sm"), "text-danger hover:bg-danger-soft hover:text-danger")}>Disconnect</ConfirmSubmit>
                        </form>
                      </div>
                    ) : groupCode ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <code className="num block rounded-md border border-line bg-sunken px-3 py-1.5 text-[13px] text-fg">/connect {groupCode}</code>
                        <form action={newGroupCode}><button className={buttonClass("ghost", "sm")}>New code</button></form>
                      </div>
                    ) : (
                      <form action={newGroupCode}><button className={buttonClass("secondary", "sm")} disabled={!configured}>Generate connect code</button></form>
                    )}
                  </div>
                </Step>
              </ol>
            </Disclosure>
          </section>

          <Card title="Linked people" flush actions={<span className="num rounded bg-neutral-soft px-1.5 text-[11px] leading-5 text-fg-subtle">{linked.length}</span>}>
            <Table head={["Name", "Role", "Alerts"]} dense empty={linked.length === 0}
              emptyTitle="Nobody has connected yet" emptyDescription="Each person connects from My account once the bot and webhook are set up.">
              {linked.map((u) => (
                <tr key={u.id}>
                  <td><Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.name}</Link></td>
                  <td><Badge value={u.role} tone={ROLE_TONE[u.role as Role] ?? "neutral"} label={ROLE_LABELS[u.role as Role] ?? u.role} /></td>
                  <td>{u.telegramAlerts ? <Badge value="ACTIVE" tone="ok" label="On" dot /> : <Badge value="OFF_DUTY" label="Paused" />}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5">Daily brief<InfoTip>Runs automatically each morning via Vercel Cron. Send one now to check the wiring.</InfoTip></span>}>
            <ActionForm action={sendDigestNow}><SubmitButton variant="secondary" size="sm" pendingText="Sending…">Send brief now</SubmitButton></ActionForm>
          </Card>

          {/* Reference lists: one open at a time. */}
          <section className={cn(cardClass, "divide-y divide-line [&>details:first-child>summary]:rounded-t-lg [&>details:last-child:not([open])>summary]:rounded-b-lg")}>
            <Disclosure name="telegram-reference" title="What gets sent" icon={<BellRing />} count={SENT.length}>
              <ul className="divide-y divide-line border-t border-line">
                {SENT.map((s) => (
                  <li key={s.what} className="flex items-start gap-3 px-4 py-2">
                    <span className="mt-0.5 shrink-0 text-fg-subtle [&_svg]:h-3.5 [&_svg]:w-3.5">{s.icon}</span>
                    <div className="min-w-0 text-[12px]">
                      <p className="text-fg">{s.what}</p>
                      <p className="text-fg-subtle">→ {s.who}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Disclosure>
            <Disclosure name="telegram-reference" title="Bot commands" icon={<Terminal />} tone="neutral" count={3}>
              <ul className="space-y-1.5 border-t border-line px-4 py-3 text-[12px] text-fg-muted">
                <li><Code>/status</Code> live fleet summary (staff only)</li>
                <li><Code>/stop</Code> mute this chat</li>
                <li><Code>/help</Code> list commands</li>
              </ul>
            </Disclosure>
          </section>
        </div>
      </div>
    </>
  );
}
