-- Team trucks: a second driver seat. Each driver sits in at most one seat of one truck (unique), and a team driver
-- needs a driver beside them (kept by src/lib/assignments.ts).
ALTER TABLE "Truck" ADD COLUMN "coDriverId" TEXT;

CREATE UNIQUE INDEX "Truck_coDriverId_key" ON "Truck"("coDriverId");

ALTER TABLE "Truck" ADD CONSTRAINT "Truck_coDriverId_fkey" FOREIGN KEY ("coDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
