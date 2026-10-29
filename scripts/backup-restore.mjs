// Nightly backups (src/lib/backup.ts): list them, download one, or load one into an EMPTY database.
//   node scripts/backup-restore.mjs list                     backups in the store (needs BLOB_READ_WRITE_TOKEN)
//   node scripts/backup-restore.mjs download [name]          the newest one (or the named one) into ./backups-local/
//   node scripts/backup-restore.mjs restore <file.json.gz>   into DATABASE_URL, which must be migrated and empty
// Restore into a fresh database (a new Neon branch, or a local one), check it, then point the app at it. It never
// writes into a database that already holds companies or accounts. A database that isn't local also needs CONFIRM=yes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { get, list } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

const PREFIX = "backups/";
const [cmd, arg] = process.argv.slice(2);
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

async function backups() {
  const out = [];
  let cursor;
  do {
    const res = await list({ prefix: PREFIX, cursor, limit: 1000 });
    out.push(...res.blobs);
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
}

async function download(name) {
  const all = await backups();
  const pick = name ? all.find((b) => b.pathname === name || b.pathname === `${PREFIX}${name}`) : all.at(-1);
  if (!pick) throw new Error(name ? `No backup called ${name}.` : "No backups yet.");
  const res = await get(pick.pathname, { access: "private" });
  if (!res || res.statusCode !== 200) throw new Error(`Couldn't read ${pick.pathname}.`);
  const file = path.join("backups-local", path.basename(pick.pathname));
  await mkdir("backups-local", { recursive: true });
  await writeFile(file, Buffer.from(await new Response(res.stream).arrayBuffer()));
  console.log(`Saved ${file} (${pick.size} bytes, from ${new Date(pick.uploadedAt).toISOString()}). It holds every company's data: keep it private and delete it when done.`);
}

async function restore(file) {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") && process.env.CONFIRM !== "yes") {
    throw new Error("Refusing: DATABASE_URL is not local. Re-run with CONFIRM=yes to restore into it.");
  }
  const backup = JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
  if (backup.app !== "fleetcore" || backup.version !== 1) throw new Error("This isn't a FleetCore backup.");
  const db = new PrismaClient();
  try {
    const applied = (await db.$queryRaw`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`).map((m) => m.name);
    if (JSON.stringify(applied) !== JSON.stringify(backup.migrations)) {
      throw new Error(`The target database's migrations (${applied.join(", ")}) differ from the backup's (${backup.migrations.join(", ")}). Run prisma migrate deploy at the backup's version first.`);
    }
    const [{ n }] = await db.$queryRaw`SELECT (SELECT COUNT(*) FROM "Company") + (SELECT COUNT(*) FROM "User") AS n`;
    if (Number(n) > 0) throw new Error("The target database already has companies or accounts. Restore only into an empty one.");
    // Parents first (the backup's order); one transaction, so a failure leaves the database empty again.
    await db.$transaction(async (tx) => {
      for (const t of backup.tables) {
        if (!t.rows.length) continue;
        await tx.$executeRawUnsafe(`INSERT INTO ${quote(t.name)} SELECT * FROM json_populate_recordset(NULL::${quote(t.name)}, $1::json)`, JSON.stringify(t.rows));
      }
    }, { timeout: 120_000 });
    for (const t of backup.tables) console.log(`${t.name.padEnd(22)} ${t.rows.length}`);
    console.log(`Restored the backup of ${backup.createdAt}.`);
  } finally {
    await db.$disconnect();
  }
}

try {
  if (cmd === "list") for (const b of await backups()) console.log(`${b.pathname}  ${b.size} bytes  ${new Date(b.uploadedAt).toISOString()}`);
  else if (cmd === "download") await download(arg);
  else if (cmd === "restore" && arg) await restore(arg);
  else {
    console.error("Usage: node scripts/backup-restore.mjs list | download [name] | restore <file.json.gz>");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
