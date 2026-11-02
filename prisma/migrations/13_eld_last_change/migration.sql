-- When an ELD sync last changed something people see: open pages refresh when it moves on.
ALTER TABLE "EldConnection" ADD COLUMN "lastChangeAt" TIMESTAMP(3);
