import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { put, get, del, list } from "@vercel/blob";

/**
 * File storage. Uses private Vercel Blob when BLOB_READ_WRITE_TOKEN is set
 * (production), otherwise the local ./storage folder (dev). Files are never
 * public: they are always streamed through /api/documents/[id] after a
 * permission check.
 */
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
// LOCAL_STORAGE_DIR pins the folder when the dev server is started from another directory.
const LOCAL_DIR = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "storage"));

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel function body limit is 4.5 MB
export const ALLOWED_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
];

export function makeKey(scope: string, filename: string) {
  const safe = filename.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  return `${scope}/${new Date().toISOString().slice(0, 7)}/${randomBytes(8).toString("hex")}-${safe}`;
}

export async function saveFile(key: string, data: Buffer, contentType: string) {
  if (blobEnabled()) {
    await put(key, data, { access: "private", contentType, addRandomSuffix: false });
    return;
  }
  const file = path.join(LOCAL_DIR, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function readFileStream(key: string): Promise<ReadableStream<Uint8Array> | null> {
  // Demo documents have no bytes in storage; render a placeholder so links work everywhere.
  if (key.startsWith("seed/")) return new Blob([placeholderPdf(key)]).stream();
  if (blobEnabled()) {
    const res = await get(key, { access: "private" });
    return res?.statusCode === 200 ? res.stream : null;
  }
  const file = path.join(LOCAL_DIR, key);
  if (!file.startsWith(LOCAL_DIR)) return null; // path traversal guard
  try {
    const buf = await readFile(file);
    return new Blob([new Uint8Array(buf)]).stream();
  } catch {
    return null;
  }
}

export async function deleteFile(key: string) {
  if (key.startsWith("seed/")) return;
  if (blobEnabled()) {
    await del(key).catch(() => undefined);
    return;
  }
  await unlink(path.join(LOCAL_DIR, key)).catch(() => undefined);
}

/** Files under a folder such as "backups/", oldest first. */
export async function listFiles(prefix: string): Promise<{ key: string; size: number; at: Date }[]> {
  const files: { key: string; size: number; at: Date }[] = [];
  if (blobEnabled()) {
    let cursor: string | undefined;
    do {
      const res = await list({ prefix, cursor, limit: 1000 });
      files.push(...res.blobs.map((b) => ({ key: b.pathname, size: b.size, at: new Date(b.uploadedAt) })));
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  } else {
    const dir = path.join(LOCAL_DIR, prefix);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const s = await stat(path.join(dir, name));
      if (s.isFile()) files.push({ key: `${prefix}${name}`, size: s.size, at: s.mtime });
    }
  }
  return files.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Minimal single-page PDF with a title line — used for seeded demo documents. */
function placeholderPdf(key: string) {
  const title = key.split("/").pop()?.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ") ?? "Document";
  const text = (s: string) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = `BT /F1 20 Tf 60 740 Td (${text(title)}) Tj 0 -30 Td /F1 11 Tf (FleetCore demo document - placeholder generated for the sample company.) Tj 0 -18 Td (Storage key: ${text(key)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
