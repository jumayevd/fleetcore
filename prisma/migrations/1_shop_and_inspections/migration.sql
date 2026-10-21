-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
ADD COLUMN     "units" TEXT NOT NULL DEFAULT 'imperial';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "roadsideId" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "dispatcher" TEXT;

-- AlterTable
ALTER TABLE "Truck" ADD COLUMN     "color" TEXT,
ADD COLUMN     "engineHours" INTEGER,
ADD COLUMN     "homeTerminal" TEXT,
ADD COLUMN     "inServiceAt" TIMESTAMP(3),
ADD COLUMN     "odometerAt" TIMESTAMP(3),
ADD COLUMN     "truckTypeId" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "chargeDriverId" TEXT,
ADD COLUMN     "driverInformedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoiceTotal" DOUBLE PRECISION,
ADD COLUMN     "odometerOutKm" INTEGER,
ADD COLUMN     "payer" TEXT NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "paymentStatus" TEXT,
ADD COLUMN     "promisedAt" TIMESTAMP(3),
ADD COLUMN     "repairType" TEXT NOT NULL DEFAULT 'REPAIR',
ADD COLUMN     "stage" TEXT,
ADD COLUMN     "stageAt" TIMESTAMP(3),
ADD COLUMN     "technician" TEXT,
ADD COLUMN     "vendorId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TruckType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "oilIntervalKm" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SHOP',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "contactName" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "work" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT,
    "body" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkAround" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "truckId" TEXT NOT NULL,
    "driverId" TEXT,
    "weekStart" DATE NOT NULL,
    "video" TEXT NOT NULL DEFAULT 'AWAITING',
    "receivedAt" TIMESTAMP(3),
    "result" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkAround_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkAroundRating" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "walkAroundId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "rating" TEXT NOT NULL,

    CONSTRAINT "WalkAroundRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "number" INTEGER NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "walkAroundId" TEXT,
    "component" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "holdsUnit" BOOLEAN NOT NULL DEFAULT false,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "workOrderId" TEXT,
    "repairedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadsideInspection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "reportNumber" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT,
    "location" TEXT,
    "driverId" TEXT,
    "truckId" TEXT,
    "trailerId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'CLEAN',
    "correctionDueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoadsideInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadsideViolation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "inspectionId" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'TRUCK',
    "oos" BOOLEAN NOT NULL DEFAULT false,
    "correctedAt" TIMESTAMP(3),

    CONSTRAINT "RoadsideViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TruckType_companyId_name_key" ON "TruckType"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_companyId_name_key" ON "Vendor"("companyId", "name");

-- CreateIndex
CREATE INDEX "WorkOrderLine_workOrderId_idx" ON "WorkOrderLine"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderEvent_workOrderId_createdAt_idx" ON "WorkOrderEvent"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "WalkAround_companyId_weekStart_idx" ON "WalkAround"("companyId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WalkAround_truckId_weekStart_key" ON "WalkAround"("truckId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WalkAroundRating_walkAroundId_component_key" ON "WalkAroundRating"("walkAroundId", "component");

-- CreateIndex
CREATE INDEX "Defect_companyId_status_idx" ON "Defect"("companyId", "status");

-- CreateIndex
CREATE INDEX "Defect_truckId_idx" ON "Defect"("truckId");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_companyId_number_key" ON "Defect"("companyId", "number");

-- CreateIndex
CREATE INDEX "RoadsideInspection_companyId_inspectedAt_idx" ON "RoadsideInspection"("companyId", "inspectedAt");

-- CreateIndex
CREATE INDEX "RoadsideViolation_inspectionId_idx" ON "RoadsideViolation"("inspectionId");

-- CreateIndex
CREATE INDEX "Document_roadsideId_idx" ON "Document"("roadsideId");

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_truckTypeId_fkey" FOREIGN KEY ("truckTypeId") REFERENCES "TruckType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_chargeDriverId_fkey" FOREIGN KEY ("chargeDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_roadsideId_fkey" FOREIGN KEY ("roadsideId") REFERENCES "RoadsideInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckType" ADD CONSTRAINT "TruckType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAround" ADD CONSTRAINT "WalkAround_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAround" ADD CONSTRAINT "WalkAround_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAround" ADD CONSTRAINT "WalkAround_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAround" ADD CONSTRAINT "WalkAround_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAroundRating" ADD CONSTRAINT "WalkAroundRating_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkAroundRating" ADD CONSTRAINT "WalkAroundRating_walkAroundId_fkey" FOREIGN KEY ("walkAroundId") REFERENCES "WalkAround"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_walkAroundId_fkey" FOREIGN KEY ("walkAroundId") REFERENCES "WalkAround"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideInspection" ADD CONSTRAINT "RoadsideInspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideViolation" ADD CONSTRAINT "RoadsideViolation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadsideViolation" ADD CONSTRAINT "RoadsideViolation_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "RoadsideInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
