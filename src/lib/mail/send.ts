import "server-only";
import { randomBytes } from "node:crypto";
import type { MailProvider } from "./shared";
import { MailError } from "./providers";

/*
 * Send one email from a connected mailbox. Gmail takes the whole message as MIME (the media upload endpoint, up to
 * 35 MB); Microsoft Graph builds it from JSON: a draft, its attachments (small ones directly, big ones through an
 * upload session), then send. Either way the email lands in the person's own Sent folder.
 */

export type OutgoingFile = { name: string; type: string; data: Buffer };
export type Outgoing = {
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  files: OutgoingFile[];
};

/* MIME (Gmail) ------------------------------------------------------- */

const b64Lines = (data: Buffer) => data.toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");
/** A header value, encoded when it isn't plain ASCII (RFC 2047). */
const headerText = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const quoted = (s: string) => `"${s.replace(/["\\\r\n]/g, "")}"`;
const address = (name: string, email: string) => (name ? `${headerText(quoted(name))} <${email}>` : email);
/** filename for Content-Disposition: plain when ASCII, else RFC 2231 (filename*=UTF-8''…). */
const fileParam = (name: string) =>
  /^[\x20-\x7e]*$/.test(name) ? `filename=${quoted(name)}` : `filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

export function buildMime(m: Outgoing) {
  const boundary = `fc_${randomBytes(12).toString("hex")}`;
  const head = [
    `From: ${address(m.from.name, m.from.email)}`,
    `To: ${m.to.join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    `Subject: ${headerText(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Lines(Buffer.from(m.text, "utf8"))].join("\r\n"),
    ...m.files.map((f) => [
      `--${boundary}`,
      `Content-Type: ${f.type || "application/octet-stream"}; name=${quoted(f.name.replace(/[^\x20-\x7e]/g, "_"))}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; ${fileParam(f.name)}`,
      "",
      b64Lines(f.data),
    ].join("\r\n")),
  ];
  return Buffer.from(`${head.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`, "utf8");
}

async function sendGmail(token: string, m: Outgoing) {
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "message/rfc822" },
    body: new Uint8Array(buildMime(m)),
    cache: "no-store",
  });
  if (!res.ok) throw new MailError(`Gmail didn't send it: ${await apiError(res)}`);
}

/* Microsoft Graph (Outlook) ------------------------------------------ */

const GRAPH = "https://graph.microsoft.com/v1.0/me";
/** Graph takes attachments under 3 MB in one request; bigger ones go through an upload session in 320 KiB multiples. */
const GRAPH_SMALL = 3 * 1024 * 1024 - 1;
const CHUNK = 320 * 1024 * 10;

async function graph(token: string, path: string, body?: unknown) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new MailError(`Outlook didn't send it: ${await apiError(res)}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}

async function sendOutlook(token: string, m: Outgoing) {
  const recipients = (xs: string[]) => xs.map((address) => ({ emailAddress: { address } }));
  const draft = (await graph(token, "/messages", {
    subject: m.subject, body: { contentType: "Text", content: m.text }, toRecipients: recipients(m.to), ccRecipients: recipients(m.cc),
  })) as { id: string };
  const id = encodeURIComponent(draft.id);
  for (const f of m.files) {
    if (f.data.length <= GRAPH_SMALL) {
      await graph(token, `/messages/${id}/attachments`, {
        "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: f.type || "application/octet-stream", contentBytes: f.data.toString("base64"),
      });
      continue;
    }
    const session = (await graph(token, `/messages/${id}/attachments/createUploadSession`, {
      AttachmentItem: { attachmentType: "file", name: f.name, size: f.data.length, contentType: f.type || "application/octet-stream" },
    })) as { uploadUrl: string };
    for (let start = 0; start < f.data.length; start += CHUNK) {
      const chunk = f.data.subarray(start, Math.min(start + CHUNK, f.data.length));
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${f.data.length}` },
        body: new Uint8Array(chunk),
        cache: "no-store",
      });
      if (!res.ok) throw new MailError(`Outlook didn't take ${f.name}: ${await apiError(res)}`);
    }
  }
  await graph(token, `/messages/${id}/send`);
}

async function apiError(res: Response) {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } | string; error_description?: string } | null;
  const msg = typeof data?.error === "object" ? data.error.message : data?.error_description ?? data?.error;
  return msg ? `${msg} (${res.status})` : `error ${res.status}`;
}

export function sendMail(provider: MailProvider, token: string, m: Outgoing) {
  return provider === "GOOGLE" ? sendGmail(token, m) : sendOutlook(token, m);
}
