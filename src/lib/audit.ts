import { db } from "./db";

export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: string,
) {
  await db.auditLog.create({ data: { userId, action, entity, entityId: entityId ?? null, details } });
}
