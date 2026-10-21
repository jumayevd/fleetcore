/** Announcement as rendered by the client item — dates pre-formatted on the server. */
export type AnnouncementDTO = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  author: string;
  createdLabel: string;
  agoLabel: string;
  /** For <input type="datetime-local"> when editing. */
  expiresInput: string;
  expiresLabel: string | null;
  expired: boolean;
  /** Expires within 48 hours. */
  expiresSoon: boolean;
};

const SOON_MS = 48 * 3_600_000;

/** Past its expiry (never expires when null). Matches the page's query: expired means `expiresAt <= now`. */
export const isExpired = (expiresAt: Date | null, now = Date.now()) => Boolean(expiresAt && expiresAt.getTime() <= now);
/** Still current but expires within 48 hours. */
export const expiresSoon = (expiresAt: Date | null, now = Date.now()) => Boolean(expiresAt && !isExpired(expiresAt, now) && expiresAt.getTime() - now < SOON_MS);
