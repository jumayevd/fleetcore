import "server-only";
import { rootDb } from "./db-root";
import { currentCompanyId } from "./tenant";

/**
 * The Prisma client the app uses: every query on a company model is scoped to the active company.
 *
 *  - reads, updates and deletes get `companyId` added to their `where` (also on findUnique, which Prisma allows next
 *    to the unique field), so another company's row is simply "not found";
 *  - creates get `companyId` filled in;
 *  - foreign keys written by a create or update (truckId, driverId, …) must point at a row of the same company.
 *
 * Accounts (User, Membership, Invite, Company) are not scoped here: they go through rootDb on purpose.
 * Raw SQL ($queryRaw / $executeRaw) is NOT scoped: always filter by companyId yourself.
 * Write relations as scalar ids (`truckId: x`), not `truck: { connect }`, so the scope can add `companyId`.
 */

const SCOPED = new Set(["Driver", "Truck", "Trailer", "WorkOrder", "FuelLog", "Document", "AuditLog", "AppSetting"]);

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert",
]);

type Ref = "driver" | "truck" | "trailer" | "workOrder";
/** Foreign keys per model that must stay inside the company. */
const REFS: Record<string, Record<string, Ref>> = {
  Truck: { driverId: "driver" },
  Trailer: { truckId: "truck" },
  WorkOrder: { truckId: "truck", trailerId: "trailer" },
  FuelLog: { truckId: "truck", driverId: "driver" },
  Document: { truckId: "truck", trailerId: "trailer", driverId: "driver", workOrderId: "workOrder" },
};

function countIn(ref: Ref, id: string, companyId: string) {
  const where = { id, companyId };
  switch (ref) {
    case "driver": return rootDb.driver.count({ where });
    case "truck": return rootDb.truck.count({ where });
    case "trailer": return rootDb.trailer.count({ where });
    case "workOrder": return rootDb.workOrder.count({ where });
  }
}

async function assertOwnRefs(model: string, data: unknown, companyId: string) {
  const refs = REFS[model];
  if (!refs || !data) return;
  const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  for (const row of rows) {
    for (const [field, ref] of Object.entries(refs)) {
      const v = row[field];
      if (typeof v === "string" && !(await countIn(ref, v, companyId))) {
        throw new Error(`${model}.${field} points at a record of another company`);
      }
    }
  }
}

const withCompanyId = (data: unknown, companyId: string) =>
  Array.isArray(data) ? data.map((d) => ({ ...(d as object), companyId })) : { ...(data as object), companyId };

function stripCompanyId(data: unknown) {
  if (data && typeof data === "object" && "companyId" in data) delete (data as Record<string, unknown>).companyId;
}

export const db = rootDb.$extends({
  name: "company-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!SCOPED.has(model)) return query(args);
        const companyId = await currentCompanyId();
        const a = (args ?? {}) as Record<string, unknown>;
        if (WHERE_OPS.has(operation)) a.where = { ...((a.where as object | undefined) ?? {}), companyId };
        switch (operation) {
          case "create":
          case "createMany":
          case "createManyAndReturn":
            a.data = withCompanyId(a.data, companyId);
            await assertOwnRefs(model, a.data, companyId);
            break;
          case "upsert":
            a.create = withCompanyId(a.create, companyId);
            stripCompanyId(a.update);
            await assertOwnRefs(model, a.create, companyId);
            await assertOwnRefs(model, a.update, companyId);
            break;
          case "update":
          case "updateMany":
          case "updateManyAndReturn":
            stripCompanyId(a.data);
            await assertOwnRefs(model, a.data, companyId);
            break;
        }
        return query(a as typeof args);
      },
    },
  },
});

export type Db = typeof db;
export { rootDb };
