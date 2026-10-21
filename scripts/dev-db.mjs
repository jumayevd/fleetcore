// Local PostgreSQL for development (uses the PostgreSQL binaries on PATH).
// Data lives in ./.pgdata (git-ignored). Production stays on Neon.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = path.resolve(".pgdata");
const port = process.env.PGPORT_DEV || "5433";

// "detach": the server must not inherit our stdio or callers (and CI) hang waiting for EOF.
const run = (cmd, args, mode = "inherit") =>
  spawnSync(cmd, args, { stdio: mode === "quiet" ? "pipe" : mode === "detach" ? "ignore" : "inherit", encoding: "utf8", windowsHide: true });

const cmd = process.argv[2] ?? "start";
if (cmd === "stop") {
  run("pg_ctl", ["stop", "-D", dir, "-m", "fast"]);
  process.exit(0);
}

if (!existsSync(dir)) {
  console.log("Initialising local PostgreSQL cluster in .pgdata …");
  const r = run("initdb", ["-D", dir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale"]);
  if (r.status !== 0) { console.error("initdb failed"); process.exit(1); }
}
const status = run("pg_ctl", ["status", "-D", dir], "quiet");
if (status.status !== 0) {
  const r = run("pg_ctl", ["start", "-D", dir, "-w", "-l", path.join(dir, "server.log"), "-o", `-p ${port}`], "detach");
  if (r.status !== 0) { console.error("pg_ctl start failed"); process.exit(1); }
} else {
  console.log("Local PostgreSQL already running.");
}
const created = run("createdb", ["-h", "localhost", "-p", port, "-U", "postgres", "fleetops"], "quiet");
if (created.status === 0) console.log("Created database fleetops.");
console.log(`Local database ready: postgresql://postgres@localhost:${port}/fleetops`);
