import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { put, get, del } from "@vercel/blob";

/**
 * File storage. Uses private Vercel Blob when BLOB_READ_WRITE_TOKEN is set
 * (production), otherwise the local ./storage folder (dev). Files are never
 * public: they are always streamed through /api/documents/[id] after a
 * permission check.
 */
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const LOCAL_DIR = path.join(process.cwd(), "storage");

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
