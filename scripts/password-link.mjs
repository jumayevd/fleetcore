// Print a one-time "set your password" link for an account, so nobody has to type or send a password:
//   npm run user:password-link -- someone@company.com
// Make the account first (no company, no usable password) with --create "Full name"; add --platform-owner to make it
// a platform owner (the Platform console, every company). Against production: the production DATABASE_URL,
// CONFIRM=yes and APP_URL=https://<the site>.
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const email = (args[0] ?? "").trim().toLowerCase();
const createName = args.includes("--create") ? args[args.indexOf("--create") + 1] : null;
const platformOwner = args.includes("--platform-owner");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/password-link.mjs <email> [--create "Full name"] [--platform-owner]');
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") && process.env.CONFIRM !== "yes") {
  console.error("Refusing: DATABASE_URL is not local. Re-run with CONFIRM=yes to use production.");
  process.exit(1);
}
const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const db = new PrismaClient();
try {
  let user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, active: true, platformRole: true } });
  if (!user && createName) {
    // A password nobody knows: the account can only be entered after the link sets one.
    const unusable = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    user = await db.user.create({ data: { name: createName, email, passwordHash: unusable, platformRole: platformOwner ? "OWNER" : null }, select: { id: true, name: true, active: true, platformRole: true } });
    await db.auditLog.create({ data: { companyId: null, userId: null, action: "create", entity: "user", entityId: user.id, details: `${email}${platformOwner ? " as platform owner" : ""} (operator)` } });
    console.log(`Created ${user.name} <${email}>${platformOwner ? " as platform owner" : ""}, with no company.`);
  } else if (user && platformOwner && user.platformRole !== "OWNER") {
    await db.user.update({ where: { id: user.id }, data: { platformRole: "OWNER" } });
    console.log(`${email} is now a platform owner.`);
  }
  if (!user) throw new Error(`No account ${email}. Add --create "Full name" to make one.`);
  if (!user.active) throw new Error(`${email} is switched off.`);
  const token = randomBytes(24).toString("base64url");
  await db.passwordLink.deleteMany({ where: { userId: user.id, usedAt: null } });
  await db.passwordLink.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3 * 86_400_000) } });
  console.log(`Set-password link for ${email} (works once, for 3 days):\n${base}/reset/${token}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
