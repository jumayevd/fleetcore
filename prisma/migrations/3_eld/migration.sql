-- CreateTable
CREATE TABLE "EldConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "timeBasis" TEXT NOT NULL DEFAULT 'AUTO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "vehicles" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EldConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EldUnit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "unitNumber" TEXT,
    "vin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "driverName" TEXT,
    "truckId" TEXT,
    "matchMode" TEXT NOT NULL DEFAULT 'AUTO',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "fixAt" TIMESTAMP(3),
    "place" TEXT,
    "fuelPct" DOUBLE PRECISION,
    "defPct" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "gpsDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gpsFrom" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EldUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EldConnection_companyId_provider_key" ON "EldConnection"("companyId", "provider");

-- CreateIndex
CREATE INDEX "EldUnit_companyId_idx" ON "EldUnit"("companyId");

-- CreateIndex
CREATE INDEX "EldUnit_truckId_idx" ON "EldUnit"("truckId");

-- CreateIndex
CREATE UNIQUE INDEX "EldUnit_connectionId_externalId_key" ON "EldUnit"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "EldConnection" ADD CONSTRAINT "EldConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EldUnit" ADD CONSTRAINT "EldUnit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EldUnit" ADD CONSTRAINT "EldUnit_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EldConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EldUnit" ADD CONSTRAINT "EldUnit_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
