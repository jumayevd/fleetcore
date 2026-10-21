import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";

type NewWorkOrder = Omit<Prisma.WorkOrderUncheckedCreateInput, "number" | "companyId">;

/**
 * Create a work order with the company's next number (#1, #2, … per company). Two people saving at the same moment can
 * pick the same number; the unique index refuses the second and it simply takes the next one.
 */
export async function createWorkOrder(data: NewWorkOrder) {
  for (let attempt = 0; ; attempt++) {
    const { _max } = await db.workOrder.aggregate({ _max: { number: true } });
    try {
      return await db.workOrder.create({ data: { ...data, number: (_max.number ?? 0) + 1 } });
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!clash || attempt >= 4) throw e;
    }
  }
}
