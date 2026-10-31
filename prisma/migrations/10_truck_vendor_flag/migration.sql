-- Vendor is no longer a status: a vendor's truck (another company's or owner's) is flagged and keeps its own status
-- (Available, Assigned, In shop, Inactive). Trucks marked Vendor go back to in service with the flag on.
ALTER TABLE "Truck" ADD COLUMN     "isVendor" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Truck" SET "isVendor" = true, "status" = 'ACTIVE', "statusReason" = NULL, "statusNote" = NULL WHERE "status" = 'VENDOR';
