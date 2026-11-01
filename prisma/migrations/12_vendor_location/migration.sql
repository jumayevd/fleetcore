-- Where each vendor is, for "Vendors near this truck": coordinates from its street address (or its city), how
-- precise they are, and when they were looked up (a vendor whose address changes is looked up again).
ALTER TABLE "Vendor" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "geoPrecision" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3);
