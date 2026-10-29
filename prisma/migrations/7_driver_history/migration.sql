-- Driver history per truck: who drove it, from when to when, what went with it, pickup photos.
ALTER TABLE "Document" ADD COLUMN     "assignmentId" TEXT;

CREATE TABLE "DriverAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "truckId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "handover" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "endNote" TEXT,
    "createdById" TEXT,
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverAssignment_companyId_truckId_idx" ON "DriverAssignment"("companyId", "truckId");
CREATE INDEX "DriverAssignment_driverId_idx" ON "DriverAssignment"("driverId");
CREATE INDEX "Document_assignmentId_idx" ON "Document"("assignmentId");

ALTER TABLE "Document" ADD CONSTRAINT "Document_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DriverAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every truck that has a driver today starts its history with that driver. The start is a best guess: the last time
-- the driver was given a truck (the audit log), else when the truck was added.
INSERT INTO "DriverAssignment" ("id", "companyId", "truckId", "driverId", "startedAt", "backfilled")
SELECT 'bf' || t."id", t."companyId", t."id", t."driverId",
       COALESCE(
         (SELECT max(a."createdAt") FROM "AuditLog" a
          WHERE a."companyId" = t."companyId" AND a."entity" = 'driver' AND a."entityId" = t."driverId" AND a."action" = 'assign truck'),
         t."createdAt"),
       true
FROM "Truck" t
WHERE t."driverId" IS NOT NULL;
