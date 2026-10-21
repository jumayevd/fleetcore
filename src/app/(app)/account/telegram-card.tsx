import { Send } from "lucide-react";
import { db } from "@/lib/db";
import { getBot, telegramConfigured } from "@/lib/telegram";
import { disconnectTelegram, sendMeTest, setTelegramAlerts, startTelegramLink } from "@/app/actions/telegram";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, InfoTip, buttonClass, cn } from "@/components/ui";
import { ConfirmSubmit } from "../admin/confirm-submit";

const WHAT: Record<string, string> = {
  OWNER: "issues, deliveries, payments, maintenance and the daily brief",
  ADMIN: "issues, deliveries, maintenance and the daily brief",
  DISPATCHER: "load status changes, driver issues, PODs and the daily brief",
  FLEET_MANAGER: "maintenance and the daily brief",
  ACCOUNTANT: "deliveries, uploaded PODs and payments",
  DRIVER: "new trip assignments and cancellations",
};

/**
 * Personal Telegram link. Three states: connected (toggle alerts, test, disconnect), link code
 * issued (deep link to the bot), or not connected (generate a link code).
 */
export async function TelegramCard({ userId }: { userId: string }) {
  if (!telegramConfigured()) {
    return (
      <Card title="Telegram alerts">
        <p className="text-[13px] text-fg-muted">Telegram alerts haven&apos;t been set up for the company yet. Ask an administrator to configure the bot.</p>
      </Card>
    );
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const bot = await getBot().catch(() => null);
  const on = u.telegramAlerts;

  return (
    <Card title={<span className="flex items-center gap-1.5">Telegram alerts<InfoTip>Get {WHAT[u.role] ?? "alerts"} on Telegram.</InfoTip></span>}
      actions={u.telegramChatId ? <Badge value="ACTIVE" tone="ok" label="Connected" dot /> : <Badge value="PLANNED" label="Not connected" />}>
      {u.telegramChatId ? (
        <div className="space-y-3">
          <form action={setTelegramAlerts.bind(null, !on)}>
            <button type="submit" role="switch" aria-checked={on} title={on ? "Pause alerts" : "Resume alerts"} className="group inline-flex items-center gap-2.5 text-[13px] text-fg">
              <span className={cn("relative inline-block h-5 w-9 rounded-full transition-colors", on ? "bg-accent" : "bg-line-strong")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-[left]", on ? "left-[18px]" : "left-0.5")} />
              </span>
              <span>{on ? "Alerts on" : "Alerts paused"}</span>
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={sendMeTest}><SubmitButton variant="secondary" size="sm" pendingText="Sending…">Send test message</SubmitButton></ActionForm>
            <form action={disconnectTelegram}>
              <ConfirmSubmit confirm="Disconnect Telegram? You will need a new link code to reconnect." className={cn(buttonClass("ghost", "sm"), "text-danger hover:bg-danger-soft hover:text-danger")}>Disconnect</ConfirmSubmit>
            </form>
          </div>
        </div>
      ) : u.telegramLinkCode && bot ? (
        <div className="space-y-3">
          <a href={`https://t.me/${bot.username}?start=${u.telegramLinkCode}`} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
            <Send />Open @{bot.username} and press Start
          </a>
          <p className="text-[11px] text-fg-subtle">After pressing <b className="font-medium text-fg-muted">Start</b> in Telegram, refresh this page. The link works once.</p>
        </div>
      ) : (
        <form action={startTelegramLink}>
          <button className={buttonClass("primary")} disabled={!bot}><Send />Connect Telegram</button>
          {!bot && <p className="mt-2 text-[11px] text-danger">The bot is unreachable. An administrator needs to check TELEGRAM_BOT_TOKEN.</p>}
        </form>
      )}
    </Card>
  );
}
