import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { deleteFile, listFiles, makeKey, saveFile } from "@/lib/storage";
import { MAIL_FILE_MAX_BYTES, type MailAttachment } from "@/lib/mail/shared";

export const dynamic = "force-dynamic";

/*
 * Attachments for an email being written in FleetCore, uploaded one at a time (a request can carry 4.5 MB at most) into
 * the private store under mail-outbox/<userId>/. Sending reads them back and deletes them; files left behind by an
 * email that was never sent are cleared after a day.
 */

const outbox = (userId: string) => `mail-outbox/${userId}/`;
const DAY = 86_400_000;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can(user.role, "fleet.edit")) return NextResponse.json({ error: "Your role can't send email from FleetCore" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  if (file.size > MAIL_FILE_MAX_BYTES) return NextResponse.json({ error: `${file.name} is larger than 4 MB` }, { status: 413 });

  const key = makeKey(outbox(user.id).slice(0, -1), file.name);
  await saveFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");

  // Tidy up after emails that were started and never sent.
  const old = (await listFiles(outbox(user.id)).catch(() => [])).filter((f) => f.at.getTime() < Date.now() - DAY);
  await Promise.all(old.map((f) => deleteFile(f.key)));

  const out: MailAttachment = { key, name: file.name.slice(0, 200), size: file.size, type: file.type || "application/octet-stream" };
  return NextResponse.json(out);
}

/** DELETE /api/mail/attachments?key=… : an attachment taken off the email before sending. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key.startsWith(outbox(user.id)) || key.includes("..")) return NextResponse.json({ error: "Not yours" }, { status: 403 });
  await deleteFile(key);
  return NextResponse.json({ ok: true });
}
