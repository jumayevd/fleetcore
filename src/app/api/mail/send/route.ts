import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isDemoEmail } from "@/lib/demo/shared";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { deleteFile, readFileStream } from "@/lib/storage";
import { accessToken } from "@/lib/mail/accounts";
import { MailError, providerLabel } from "@/lib/mail/providers";
import { sendMail, type OutgoingFile } from "@/lib/mail/send";
import { MAIL_MAX_FILES, MAIL_PROVIDERS, MAIL_TOTAL_MAX_BYTES } from "@/lib/mail/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const email = z.string().trim().email();
const Body = z.object({
  provider: z.enum(MAIL_PROVIDERS),
  to: z.array(email).min(1, "Add who it goes to").max(20),
  cc: z.array(email).max(20).default([]),
  subject: z.string().trim().min(1, "Add a subject").max(300),
  text: z.string().max(50_000),
  attachments: z.array(z.object({ key: z.string(), name: z.string().max(200), type: z.string().max(200) })).max(MAIL_MAX_FILES).default([]),
  /** The vendor the email is about (its page), for the audit log. */
  vendorId: z.string().optional(),
});

/** POST JSON → send through the person's connected Gmail or Outlook, then clear the uploaded attachments. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "fleet.edit")) return NextResponse.json({ error: "Your role can't send email from FleetCore" }, { status: 403 });
  if (isDemoEmail(user.email)) return NextResponse.json({ error: "Email is off in the live demo" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    const msg = field === "to" || field === "cc" ? (issue.code === "too_small" ? issue.message : "One of the addresses doesn't look right") : issue?.message ?? "Check the email";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const m = parsed.data;
  const mine = `mail-outbox/${user.id}/`;
  if (m.attachments.some((a) => !a.key.startsWith(mine) || a.key.includes(".."))) return NextResponse.json({ error: "An attachment isn't yours" }, { status: 403 });
  const vendor = m.vendorId ? await db.vendor.findUnique({ where: { id: m.vendorId }, select: { id: true, name: true } }) : null;

  try {
    const files: OutgoingFile[] = [];
    for (const a of m.attachments) {
      const stream = await readFileStream(a.key);
      if (!stream) throw new MailError(`${a.name} is no longer uploaded. Take it off and attach it again.`);
      files.push({ name: a.name, type: a.type, data: Buffer.from(await new Response(stream).arrayBuffer()) });
    }
    const total = files.reduce((s, f) => s + f.data.length, 0);
    if (total > MAIL_TOTAL_MAX_BYTES) throw new MailError("The attachments add up to more than 18 MB. Send some in a second email.");

    const { token, email: from } = await accessToken(user.id, m.provider);
    await sendMail(m.provider, token, { from: { name: user.name, email: from }, to: m.to, cc: m.cc, subject: m.subject, text: m.text, files });
    await Promise.all(m.attachments.map((a) => deleteFile(a.key)));
    await audit(user.id, "email", vendor ? "vendor" : "email", vendor?.id ?? null,
      `${vendor ? `${vendor.name}: ` : ""}"${m.subject}" to ${m.to.join(", ")}${m.cc.length ? ` (cc ${m.cc.join(", ")})` : ""}` +
      `${files.length ? ` · ${files.length} ${files.length === 1 ? "attachment" : "attachments"}` : ""} · from ${from} via ${providerLabel(m.provider)}`);
    return NextResponse.json({ ok: true, from });
  } catch (e) {
    if (e instanceof MailError) return NextResponse.json({ error: e.message, reconnect: /connect/i.test(e.message) }, { status: 400 });
    console.error("[mail] send failed", e);
    return NextResponse.json({ error: "Couldn't send it. Try again in a moment." }, { status: 500 });
  }
}
