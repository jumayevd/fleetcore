import "server-only";

/*
 * Which email addresses may be invited into a company. MEMBER_EMAIL_DOMAINS lists the domains, comma-separated
 * ("fleetcore.com"); unset means any address (local demo data uses demo.local). Production sets fleetcore.com, so
 * every teammate an owner or admin brings in has a company address.
 */

export function memberDomains(): string[] {
  return (process.env.MEMBER_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function emailAllowed(email: string, domains = memberDomains()) {
  if (!domains.length) return true;
  const at = email.lastIndexOf("@");
  return at > 0 && domains.includes(email.slice(at + 1).toLowerCase());
}

/** "@fleetcore.com" or "@a.com or @b.com", for messages and hints. */
export const domainsText = (domains = memberDomains()) => domains.map((d) => `@${d}`).join(" or ");
