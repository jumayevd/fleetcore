import "server-only";
import { gzipSync } from "node:zlib";
import { rootDb } from "@/lib/db-root";
import { deleteFile, listFiles, saveFile } from "@/lib/storage";

/*
 * Nightly copy of the whole database (every table, every company) into the private file store under backups/, as
 * gzipped JSON: { app, version, createdAt, migrations, tables: [{ name, rows }] }. Tables are listed parents first, so
 * scripts/backup-restore.mjs can load them into an empty database in that order without breaking a foreign key.
 * The copy holds everything the database does (password hashes, the encrypted ELD tokens), so it never leaves the
 * private store; uploaded files are not in it (they live in the store already).
 */

export const BACKUP_PREFIX = "backups/";
const KEEP_DAYS = 30;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every table of the app, parents before the tables that point at them. */
async function tablesInOrder() {
  const tables = (await rootDb.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`).map((t) => t.name);
  const links = await rootDb.$queryRaw<{ child: string; parent: string }[]>`
    SELECT DISTINCT child.relname AS child, parent.relname AS parent
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public' AND child.relname <> parent.relname`;
  const ordered: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => !links.some((l) => l.child === t && left.has(l.parent)));
    // A cycle would leave nothing ready: keep going in name order rather than skip tables (a restore then says so).
    for (const t of ready.length ? ready : [...left]) { ordered.push(t); left.delete(t); }
  }
  return ordered;
}

export async function runBackup(now = new Date()) {
  const tables = await tablesInOrder();
  const migrations = (await rootDb.$queryRaw<{ name: string }[]>`
    SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`).map((m) => m.name);
  // Rows come back as JSON text straight from Postgres, so dates and numbers are written exactly as stored.
  const parts: string[] = [];
  const counts: Record<string, number> = {};
  for (const name of tables) {
    const [r] = await rootDb.$queryRawUnsafe<{ rows: string; n: number }[]>(
      `SELECT COALESCE(json_agg(t), '[]'::json)::text AS rows, COUNT(*)::int AS n FROM ${quote(name)} t`,
    );
    counts[name] = r.n;
    parts.push(`{"name":${JSON.stringify(name)},"rows":${r.rows}}`);
  }
  const json = `{"app":"fleetcore","version":1,"createdAt":${JSON.stringify(now.toISOString())},"migrations":${JSON.stringify(migrations)},"tables":[${parts.join(",")}]}`;
  const data = gzipSync(Buffer.from(json, "utf8"));
  const key = `${BACKUP_PREFIX}fleetcore-${now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.json.gz`;
  await saveFile(key, data, "application/gzip");

  // Keep a month of copies.
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const old = (await listFiles(BACKUP_PREFIX)).filter((f) => f.at.getTime() < cutoff && f.key !== key);
  for (const f of old) await deleteFile(f.key);

  return { key, bytes: data.length, tables: tables.length, rows: Object.values(counts).reduce((s, n) => s + n, 0), removed: old.length };
}
