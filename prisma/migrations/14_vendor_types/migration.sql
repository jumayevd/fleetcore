-- A vendor can be several types (a repair shop that also tows). `type` stays as the first of them.
ALTER TABLE "Vendor" ADD COLUMN "types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Vendor" SET "types" = ARRAY["type"];
