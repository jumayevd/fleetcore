import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The unscoped Prisma client. Use it only for accounts, memberships, invites and companies, or with an explicit
 * `companyId` in jobs that span companies. Everything else imports `db` from ./db, which is scoped to the active
 * company of the request.
 */
export const rootDb = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rootDb;
