-- A vendor truck's owner and the share of its earnings the company keeps (%).
ALTER TABLE "Truck" ADD COLUMN     "vendorName" TEXT,
ADD COLUMN     "vendorKeepPct" DOUBLE PRECISION;
