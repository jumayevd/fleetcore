// Set a new password for an account (there is no email-based reset yet):
//   npx dotenv -e .env.local -- node scripts/reset-password.mjs someone@company.com 'new-password'
// Against production, run it with the production DATABASE_URL and CONFIRM=yes.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new password, 8+ characters>");
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") && process.env.CONFIRM !== "yes") {
  console.error("Refusing: DATABASE_URL is not local. Re-run with CONFIRM=yes to change a production password.");
  process.exit(1);
}
const db = new PrismaClient();
try {
  // A new password signs the account out everywhere (src/lib/session.ts) and lifts a sign-in pause.
  const user = await db.user.update({ where: { email: email.toLowerCase() }, data: { passwordHash: await bcrypt.hash(password, 10), sessionsValidFrom: new Date() } });
  await db.loginThrottle.deleteMany({ where: { key: `email:${user.email}` } });
  console.log(`Password updated for ${user.email}; its other sign-ins have ended.`);
} catch {
  console.error(`No account with email ${email}.`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
