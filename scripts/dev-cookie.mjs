// Prints a Cookie header for a demo account working in one of its companies, so pages can be smoke-tested with curl:
//   node scripts/dev-cookie.mjs aziza@demo.local "Caspian Carriers"
//   curl -s -H "Cookie: $(node scripts/dev-cookie.mjs aziza@demo.local)" -o /dev/null -w '%{http_code}\n' localhost:3000/dashboard
// Without a company name it uses the account's first company. Local development only (reads AUTH_SECRET from .env / .env.local).
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

for (const f of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)="?([^"\n\r]*)"?\r?$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not a local database.");
  process.exit(1);
}
const email = process.argv[2] ?? "aziza@demo.local";
const companyName = process.argv[3];
const db = new PrismaClient();
const user = await db.user.findUnique({
  where: { email },
  include: { memberships: { where: { active: true }, include: { company: { select: { id: true, name: true } } }, orderBy: { company: { name: "asc" } } } },
});
await db.$disconnect();
if (!user) { console.error(`No user ${email}`); process.exit(1); }
const membership = companyName ? user.memberships.find((m) => m.company.name === companyName) : user.memberships[0];
if (!membership) { console.error(`${email} is not a member of ${companyName ?? "any company"}`); process.exit(1); }
const at = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ acc: [{ u: user.id, t: at }] }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(at + 3600).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
process.stdout.write(`fo_session=${token}; fo_active=${user.id}.${membership.company.id}`);
