/** Mail providers a person can connect to send email from FleetCore (src/lib/mail/providers.ts). Client-safe. */
export const MAIL_PROVIDERS = ["GOOGLE", "MICROSOFT"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const MAIL_PROVIDER_LABELS: Record<MailProvider, string> = { GOOGLE: "Gmail", MICROSOFT: "Outlook" };

/**
 * Attachments are uploaded one at a time before sending, since a request to the server can carry at most 4.5 MB.
 * Bigger photos are shrunk in the browser first. The whole email stays under what Gmail accepts (25 MB once encoded).
 */
export const MAIL_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const MAIL_TOTAL_MAX_BYTES = 18 * 1024 * 1024;
export const MAIL_MAX_FILES = 10;

/** What the compose window knows about the person's connected mailboxes. */
export type MailboxState = { provider: MailProvider; configured: boolean; email: string | null };

export type MailAttachment = { key: string; name: string; size: number; type: string };
