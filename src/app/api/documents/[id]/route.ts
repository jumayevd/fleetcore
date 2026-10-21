import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { readFileStream } from "@/lib/storage";
import { canViewDocs, targetOf } from "@/lib/documents";

const INLINE = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"];

/** Streams a document after checking the viewer may see its parent record. */
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await ctx.params;
  const doc = await db.document.findUnique({ where: { id } });
  const target = doc && targetOf(doc);
  if (!doc || !target || !(await canViewDocs(user, target))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stream = await readFileStream(doc.storageKey);
  if (!stream) return NextResponse.json({ error: "File missing from storage" }, { status: 410 });
  const download = new URL(req.url).searchParams.has("download") || !INLINE.includes(doc.contentType);
  return new Response(stream, {
    headers: {
      "Content-Type": doc.contentType,
      // Seeded demo documents stream a generated placeholder whose length differs from the stored size.
      ...(doc.storageKey.startsWith("seed/") ? {} : { "Content-Length": String(doc.size) }),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
