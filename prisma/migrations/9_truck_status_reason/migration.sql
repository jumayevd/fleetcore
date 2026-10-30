-- Why a truck is in its status (Inactive: sold, stolen…), any details, and since when.
ALTER TABLE "Truck" ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "statusNote" TEXT,
ADD COLUMN     "statusSince" TIMESTAMP(3);
