"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { notifyContact } from "@/lib/contact-notify";
import { rootDb } from "@/lib/db-root";
import { attempt, fields, FormError, type ActionState } from "@/lib/action";
import { addAccount, writeActive } from "@/lib/session";
import { HOME } from "@/lib/permissions";
import { demoWorkspace, isDemoEnabled } from "@/lib/demo";
import { CONTACT_PLANS } from "@/lib/site";

/** /demo → "Open the live demo": sign this browser in to the shared demo account and go to its fleet. */
export async function openDemo() {
  if (!isDemoEnabled()) redirect("/demo");
  const { companyId, visitorId } = await demoWorkspace();
  await addAccount(visitorId);
  await writeActive(visitorId, companyId);
  redirect(HOME);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : null);

/** The public contact form (/contact). Lands in the Platform console. */
export async function sendContact(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const f = fields(fd);
    // A field people never see: only bots fill it in. Pretend it worked.
    if (f.str("website")) return { ok: "sent" };
    const name = f.req("name", "Your name");
    const email = f.req("email", "Email").toLowerCase();
    if (!EMAIL.test(email)) throw new FormError("That email doesn't look right.");
    const plan = f.str("plan");
    // A flood from one address, or from everyone at once, is a bot: slow it down.
    const since = new Date(Date.now() - 10 * 60_000);
    const [mine, all] = await Promise.all([
      rootDb.contactRequest.count({ where: { email, createdAt: { gt: since } } }),
      rootDb.contactRequest.count({ where: { createdAt: { gt: since } } }),
    ]);
    if (mine >= 3 || all >= 30) throw new FormError("We've got your message already. We'll be in touch shortly.");
    const saved = await rootDb.contactRequest.create({
      data: {
        name: clip(name, 120)!, email: clip(email, 200)!, phone: clip(f.phone("phone"), 40), company: clip(f.str("company"), 160),
        fleetSize: clip(f.str("fleetSize"), 40), plan: plan && CONTACT_PLANS.some((p) => p.id === plan) ? plan : null, message: clip(f.str("message"), 4000),
      },
    });
    // Email it to the people who answer, after the visitor has their "Thanks" (src/lib/contact-notify).
    after(() => notifyContact(saved));
    return { ok: "sent" };
  });
}
