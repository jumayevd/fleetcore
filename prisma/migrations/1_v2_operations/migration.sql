-- DropForeignKey
ALTER TABLE "MaintenanceRecord" DROP CONSTRAINT "MaintenanceRecord_truckId_fkey";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'SHIPPER';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "claimId" TEXT,
ADD COLUMN     "isCompany" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trailerId" TEXT,
ADD COLUMN     "workOrderId" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "boardStatus" TEXT NOT NULL DEFAULT 'READY',
ADD COLUMN     "boardStatusManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "boardStatusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'COMPANY',
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "billingStage" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "brokerId" TEXT,
ADD COLUMN     "customerRef" TEXT,
ADD COLUMN     "emptyKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Trailer" ADD COLUMN     "gpsProvider" TEXT,
ADD COLUMN     "inspectionExpiry" TIMESTAMP(3),
ADD COLUMN     "insuranceExpiry" TIMESTAMP(3),
ADD COLUMN     "lastPingAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "locationName" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "truckId" TEXT,
ADD COLUMN     "year" INTEGER,
ALTER COLUMN "status" SET DEFAULT 'EMPTY';

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "engineOn" BOOLEAN,
ADD COLUMN     "fuelEconomy" DOUBLE PRECISION,
ADD COLUMN     "fuelPct" DOUBLE PRECISION,
ADD COLUMN     "group" TEXT,
ADD COLUMN     "lastPmAt" TIMESTAMP(3),
ADD COLUMN     "lastPmKm" INTEGER,
ADD COLUMN     "leaseAnnualLimitKm" INTEGER,
ADD COLUMN     "leaseBufferPct" DOUBLE PRECISION,
ADD COLUMN     "leaseOverageRate" DOUBLE PRECISION,
ADD COLUMN     "leaseStartKm" INTEGER,
ADD COLUMN     "lessor" TEXT,
ADD COLUMN     "locationName" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "ownership" TEXT NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "pmIntervalKm" INTEGER NOT NULL DEFAULT 30000,
ADD COLUMN     "registrationExpiry" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "teamId" TEXT;

-- DropTable
DROP TABLE "MaintenanceRecord";

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverStatusEvent" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardCell" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "driverId" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "color" TEXT,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stop" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "vendor" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "inAt" TIMESTAMP(3),
    "outAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "odometerKm" INTEGER,
    "laborCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "partsCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "incidentAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "fault" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "amountClaimed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountSettled" DOUBLE PRECISION,
    "driverId" TEXT,
    "loadId" TEXT,
    "truckId" TEXT,
    "trailerId" TEXT,
    "customerId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimNote" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "DriverStatusEvent_driverId_at_idx" ON "DriverStatusEvent"("driverId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "BoardCell_date_driverId_column_key" ON "BoardCell"("date", "driverId", "column");

-- CreateIndex
CREATE INDEX "Stop_loadId_seq_idx" ON "Stop"("loadId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_number_key" ON "WorkOrder"("number");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_truckId_idx" ON "WorkOrder"("truckId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_number_key" ON "Claim"("number");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "ChatMessage_room_createdAt_idx" ON "ChatMessage"("room", "createdAt");

-- CreateIndex
CREATE INDEX "Document_trailerId_idx" ON "Document"("trailerId");

-- CreateIndex
CREATE INDEX "Document_claimId_idx" ON "Document"("claimId");

-- CreateIndex
CREATE INDEX "Load_driverId_status_idx" ON "Load"("driverId", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStatusEvent" ADD CONSTRAINT "DriverStatusEvent_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverStatusEvent" ADD CONSTRAINT "DriverStatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCell" ADD CONSTRAINT "BoardCell_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCell" ADD CONSTRAINT "BoardCell_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data migration: map v1 vocabularies onto v2 columns.
UPDATE "Driver" SET "boardStatus" = CASE "status"
    WHEN 'DRIVING' THEN 'EN_ROUTE'
    WHEN 'ON_DUTY' THEN 'DISPATCHED'
    WHEN 'OFF_DUTY' THEN 'HOME'
    WHEN 'ON_LEAVE' THEN 'VACATION'
    ELSE 'READY' END;
UPDATE "Driver" SET "status" = CASE "status"
    WHEN 'ON_LEAVE' THEN 'ON_LEAVE'
    ELSE 'ACTIVE' END;
UPDATE "Trailer" SET "status" = CASE "status"
    WHEN 'MAINTENANCE' THEN 'SHOP'
    WHEN 'OUT_OF_SERVICE' THEN 'OUT_OF_SERVICE'
    ELSE 'EMPTY' END;
UPDATE "Trailer" t SET "status" = 'IN_USE', "truckId" = l."truckId"
  FROM "Load" l WHERE l."trailerId" = t."id" AND l."status" IN ('ASSIGNED', 'IN_TRANSIT');
UPDATE "Load" SET "billingStage" = CASE
    WHEN "status" = 'INVOICED' THEN 'INVOICED'
    WHEN "status" = 'DELIVERED' THEN 'MISSING_DOCS'
    ELSE 'NONE' END;
UPDATE "Load" l SET "billingStage" = 'PAID' FROM "Invoice" i WHERE i."loadId" = l."id" AND i."status" = 'PAID';
-- Every existing load gets its two stops from the denormalised route fields.
INSERT INTO "Stop" ("id", "loadId", "seq", "type", "name", "city", "lat", "lng", "windowStart", "status", "arrivedAt", "departedAt")
SELECT 'stp_' || md5(l."id" || 'p'), l."id", 1, 'PICKUP', l."originName", l."originCity", l."originLat", l."originLng", l."pickupAt",
       CASE WHEN l."departedAt" IS NOT NULL THEN 'DONE' ELSE 'PENDING' END, l."departedAt", l."departedAt"
FROM "Load" l;
INSERT INTO "Stop" ("id", "loadId", "seq", "type", "name", "city", "lat", "lng", "windowEnd", "status", "arrivedAt", "departedAt")
SELECT 'stp_' || md5(l."id" || 'd'), l."id", 2, 'DELIVERY', l."destName", l."destCity", l."destLat", l."destLng", l."deliveryAt",
       CASE WHEN l."deliveredAt" IS NOT NULL THEN 'DONE' ELSE 'PENDING' END, l."deliveredAt", l."deliveredAt"
FROM "Load" l;
