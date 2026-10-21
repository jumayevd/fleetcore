"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, FormError, type ActionState } from "@/lib/action";
import { INVOICE_STATUSES, LOAD_STATUS_LABELS } from "@/lib/constants";
import { date } from "@/lib/format";
import { notifyInvoicePaid } from "@/lib/notify";
import { recomputeBillingStage } from "@/lib/workflow";
import { INVOICE_TRANSITIONS, wasTonu } from "./shared";

const DAY = 86_400_000;
const DONE: Record<string, string> = { DRAFT: "moved back to draft", SENT: "marked sent", PAID: "marked paid", VOID: "voided" };

/**
 * Move an invoice along its lifecycle (draft → sent → paid, or draft / sent → void) and keep its load in step.
 *
 * - Sent: the invoice is dated today and falls due the bill-to party's payment terms from today.
 * - Paid: the load's billing stage becomes Paid.
 * - Void: the invoice keeps its number for the record but lets go of the load (a load holds one invoice), and the
 *   load goes back to Delivered (or TONU) so it returns to the billing queue and can be invoiced again.
 */
export async function updateInvoiceStatus(invoiceId: string, status: string): Promise<ActionState> {
  const me = await requireUser("finance.edit");
  let loadId = null as string | null; // set inside attempt(); revalidated after it either way

  const res = await attempt(async () => {
    if (!(INVOICE_STATUSES as readonly string[]).includes(status)) throw new FormError("Unknown invoice status.");
    const inv = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        number: true, status: true, notes: true,
        customer: { select: { paymentTerms: true } },
        load: { select: { id: true, reference: true, status: true, deliveredAt: true, originCity: true, destCity: true } },
      },
    });
    if (!inv) throw new FormError("This invoice no longer exists. Reload the page.");
    if (!INVOICE_TRANSITIONS[inv.status]?.includes(status)) {
      throw new FormError(`${inv.number} is ${inv.status.toLowerCase()} and cannot be ${DONE[status]}. Reload the page to see its current state.`);
    }

    const now = new Date();
    const load = inv.load;
    loadId = load?.id ?? null;
    const data: Prisma.InvoiceUncheckedUpdateManyInput = { status };
    if (status === "SENT") {
      data.issuedAt = now;
      data.dueAt = new Date(now.getTime() + inv.customer.paymentTerms * DAY);
    }
    if (status === "PAID") data.paidAt = now;
    // Only a void sends the load back: Delivered, or TONU when it never delivered.
    const voidLoad = status === "VOID" ? load : null;
    const back = voidLoad?.status === "INVOICED" ? (wasTonu(voidLoad) ? "TONU" : "DELIVERED") : null;
    if (voidLoad) {
      data.loadId = null;
      data.notes = [inv.notes, `Voided ${date(now)}. Raised for load ${voidLoad.reference}, ${voidLoad.originCity} to ${voidLoad.destCity}.`]
        .filter(Boolean).join("\n");
    }

    await db.$transaction(async (tx) => {
      // Compare-and-set on the status read above, so two people acting on one invoice cannot both win.
      const { count } = await tx.invoice.updateMany({ where: { id: invoiceId, status: inv.status }, data });
      if (count === 0) throw new FormError(`${inv.number} was changed by someone else just now. Reload the page to see its current state.`);
      if (voidLoad) {
        if (back) await tx.load.update({ where: { id: voidLoad.id }, data: { status: back } });
        await tx.loadEvent.create({
          data: {
            loadId: voidLoad.id, type: "BILLING", userId: me.id,
            message: `Invoice ${inv.number} voided${back ? ` · status back to ${LOAD_STATUS_LABELS[back]}` : ""} · back in the billing queue`,
          },
        });
      }
    });

    await audit(me.id, "status", "invoice", invoiceId, `${inv.number} → ${status}`);
    if (voidLoad && back) await audit(me.id, "status", "load", voidLoad.id, `${voidLoad.reference}: INVOICED → ${back} (invoice ${inv.number} voided)`);
    // Paid → billing stage Paid; void → Missing docs or Ready to invoice again.
    if (load && (status === "PAID" || status === "VOID")) await recomputeBillingStage(load.id, me.id);
    if (status === "PAID") after(() => notifyInvoicePaid(invoiceId));
  });

  revalidatePath("/finance");
  revalidatePath(`/finance/invoices/${invoiceId}`);
  if (loadId) {
    revalidatePath("/loads");
    revalidatePath(`/loads/${loadId}`);
  }
  return res;
}
