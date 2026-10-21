"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createInvoiceForLoad } from "@/lib/workflow";

// Invoice status changes (send / paid / void) live in src/app/(app)/finance/actions.ts (updateInvoiceStatus), which
// guards the transitions, unlinks voided invoices and keeps the load's billing stage in step.

export async function invoiceLoad(loadId: string) {
  const me = await requireUser("finance.edit");
  const load = await db.load.findUniqueOrThrow({ where: { id: loadId } });
  if (load.status !== "DELIVERED" && load.status !== "TONU") throw new Error("Only delivered or TONU loads can be invoiced");
  const inv = await createInvoiceForLoad(loadId, me.id);
  await db.load.update({ where: { id: loadId }, data: { status: "INVOICED" } });
  await db.loadEvent.create({ data: { loadId, type: "STATUS", message: `Invoice ${inv.number} generated`, userId: me.id } });
  revalidatePath("/finance");
  redirect(`/finance/invoices/${inv.id}`);
}
