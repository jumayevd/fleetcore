import "server-only";
import { rootDb } from "@/lib/db-root";
import { PLATFORM_OWNER } from "@/lib/platform";
import { accessToken } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/send";
import { MAIL_PROVIDERS } from "@/lib/mail/shared";
import { CONTACT_PLANS, SITE } from "@/lib/site";

/*
 * A new message from the public contact form (/contact) is saved for the Platform console and also emailed to the
 * people who answer it. FleetCore has no mail server of its own, so the email goes out from a mailbox connected in
 * FleetCore (Account → Email), the same way "Write in FleetCore" sends:
 *
 *  - CONTACT_NOTIFY_EMAILS  who gets it: comma-separated addresses. Unset: every active platform owner.
 *  - CONTACT_MAIL_SENDER    the FleetCore login whose connected Gmail/Outlook sends it. Unset: the first active platform
 *                           owner with a connected mailbox.
 *
 * Replies go straight to the person who wrote (Reply-To). Nothing here can make the form fail: a missing mailbox or a
 * refused send is only logged, and the message is still in the Platform console.
 */

type Contact = { name: string; email: string; phone: string | null; company: string | null; fleetSize: string | null; plan: string | null; message: string | null };

const list = (v: string | undefined) => (v ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));

async function recipients() {
  const set = list(process.env.CONTACT_NOTIFY_EMAILS);
  if (set.length) return [...new Set(set)];
  const owners = await rootDb.user.findMany({ where: { platformRole: PLATFORM_OWNER, active: true }, select: { email: true } });
  return owners.map((o) => o.email);
}

async function sender() {
  const login = list(process.env.CONTACT_MAIL_SENDER)[0];
  const where = login ? { user: { email: login, active: true } } : { user: { platformRole: PLATFORM_OWNER, active: true } };
  const box = await rootDb.mailAccount.findFirst({ where, orderBy: { createdAt: "asc" }, select: { userId: true, provider: true } });
  const provider = MAIL_PROVIDERS.find((p) => p === box?.provider);
  return box && provider ? { userId: box.userId, provider } : null;
}

export async function notifyContact(c: Contact) {
  try {
    const [to, from] = await Promise.all([recipients(), sender()]);
    if (!to.length) return console.warn("contact form: nobody to notify (set CONTACT_NOTIFY_EMAILS)");
    if (!from) return console.warn("contact form: no connected mailbox to send from (connect Gmail under Account, or set CONTACT_MAIL_SENDER)");
    const { token, email } = await accessToken(from.userId, from.provider);
    const plan = c.plan ? CONTACT_PLANS.find((p) => p.id === c.plan)?.name ?? c.plan : null;
    const rows: [string, string | null][] = [
      ["Name", c.name], ["Email", c.email], ["Phone", c.phone], ["Company", c.company], ["Fleet size", c.fleetSize], ["Plan", plan],
    ];
    const text = [
      `New message from the ${SITE.name} contact form.`,
      "",
      ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      "",
      c.message ? `Message:\n${c.message}` : "(No message.)",
      "",
      "Reply to this email to answer them. It is also in the Platform console under Contact requests.",
    ].join("\n");
    await sendMail(from.provider, token, {
      from: { name: `${SITE.name} website`, email },
      to, cc: [], replyTo: c.email, files: [],
      subject: `New enquiry: ${c.name}${c.company ? `, ${c.company}` : ""}`,
      text,
    });
  } catch (e) {
    console.error("contact form: email not sent:", e instanceof Error ? e.message : e);
  }
}
