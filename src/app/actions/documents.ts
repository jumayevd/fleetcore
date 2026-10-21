"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { deleteFile } from "@/lib/storage";
import { canDeleteDoc } from "@/lib/documents";
import { recomputeBillingStage } from "@/lib/workflow";

export async function deleteDocument(id: string, revalidate: string) {
  const me = await requireUser();
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc || !(await canDeleteDoc(me, doc))) throw new Error("Not allowed");
  await db.document.delete({ where: { id } });
  await deleteFile(doc.storageKey);
  await audit(me.id, "delete", "document", id, doc.name);
  if (doc.loadId) await recomputeBillingStage(doc.loadId, me.id);
  revalidatePath(revalidate);
}
