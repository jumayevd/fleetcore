import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Encrypt small secrets (ELD API tokens) before they go into the database: AES-256-GCM with a key derived from
 * AUTH_SECRET, so a database dump alone doesn't hand out anyone's tokens. Changing AUTH_SECRET makes saved tokens
 * unreadable: the integration then asks for the token again.
 */

const VERSION = "v1";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(`${secret}:fleetcore-secret-box`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The secret, or null when it can't be opened (tampered, or sealed with another AUTH_SECRET). */
export function open(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "…k3Pz": enough to tell two tokens apart, never enough to use one. */
export const hint = (secret: string) => `…${secret.trim().slice(-4)}`;
