-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "telegramChatId" TEXT,
    "telegramLinkCode" TEXT,
    "telegramAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "licenseNumber" TEXT NOT NULL,
    "licenseClass" TEXT NOT NULL DEFAULT 'CE',
    "licenseExpiry" TIMESTAMP(3) NOT NULL,
    "medicalExpiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payPerKm" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vin" TEXT,
    "plate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "fuelType" TEXT NOT NULL DEFAULT 'DIESEL',
    "fuelCapacityL" INTEGER NOT NULL DEFAULT 600,
    "insuranceExpiry" TIMESTAMP(3),
    "inspectionExpiry" TIMESTAMP(3),
    "nextServiceKm" INTEGER,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "lastPingAt" TIMESTAMP(3),
    "pingSource" TEXT,
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trailer" (
    "id" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacityKg" INTEGER NOT NULL,
    "plate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'Uzbekistan',
    "taxId" TEXT,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "originName" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destName" TEXT NOT NULL,
    "destCity" TEXT NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "deliveryAt" TIMESTAMP(3) NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "commodity" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "pallets" INTEGER,
    "equipment" TEXT NOT NULL DEFAULT 'DRY_VAN',
    "temperatureC" DOUBLE PRECISION,
    "hazmat" BOOLEAN NOT NULL DEFAULT false,
    "rate" DOUBLE PRECISION NOT NULL,
    "driverPay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fuelCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "truckId" TEXT,
    "trailerId" TEXT,
    "driverId" TEXT,
    "dispatcherId" TEXT,
    "departedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "podSignedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadEvent" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "odometerKm" INTEGER,
    "vendor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "driverId" TEXT,
    "liters" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "odometerKm" INTEGER,
    "station" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "loadId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "loadId" TEXT,
    "truckId" TEXT,
    "driverId" TEXT,
    "customerId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkCode_key" ON "User"("telegramLinkCode");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_unitNumber_key" ON "Truck"("unitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_driverId_key" ON "Truck"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Trailer_unitNumber_key" ON "Trailer"("unitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Load_reference_key" ON "Load"("reference");

-- CreateIndex
CREATE INDEX "Load_status_idx" ON "Load"("status");

-- CreateIndex
CREATE INDEX "Load_pickupAt_idx" ON "Load"("pickupAt");

-- CreateIndex
CREATE INDEX "LoadEvent_loadId_idx" ON "LoadEvent"("loadId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_loadId_key" ON "Invoice"("loadId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_loadId_idx" ON "Document"("loadId");

-- CreateIndex
CREATE INDEX "Document_truckId_idx" ON "Document"("truckId");

-- CreateIndex
CREATE INDEX "Document_driverId_idx" ON "Document"("driverId");

-- CreateIndex
CREATE INDEX "Document_customerId_idx" ON "Document"("customerId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadEvent" ADD CONSTRAINT "LoadEvent_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadEvent" ADD CONSTRAINT "LoadEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

