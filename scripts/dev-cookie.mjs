// Prints a signed session cookie for a demo user so pages can be smoke-tested with curl:
//   node scripts/dev-cookie.mjs owner@demo.local
//   curl -s -b "lp_session=$(node scripts/dev-cookie.mjs owner@demo.local)" -o /dev/null -w '%{http_code}\n' localhost:3000/dashboard
// Local development only (reads AUTH_SECRET from .env / .env.local).
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

for (const f of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)="?([^"\n]*)"?$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not a local database.");
  process.exit(1);
}
const email = process.argv[2] ?? "owner@demo.local";
const db = new PrismaClient();
const user = await db.user.findUnique({ where: { email } });
await db.$disconnect();
if (!user) { console.error(`No user ${email}`); process.exit(1); }
const token = await new SignJWT({ sub: user.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
process.stdout.write(token);
