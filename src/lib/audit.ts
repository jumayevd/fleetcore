import "server-only";
import { db } from "./db";

/** Record a change in the active company's audit log. */
export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: string,
) {
  await db.auditLog.create({ data: { userId, action, entity, entityId: entityId ?? null, details } });
}
