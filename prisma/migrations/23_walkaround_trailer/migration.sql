-- The trailer hooked to the truck on a walk-around video: one on file, or just its number.
ALTER TABLE "WalkAround" ADD COLUMN "trailerId" TEXT, ADD COLUMN "trailerNumber" TEXT;
ALTER TABLE "WalkAround" ADD CONSTRAINT "WalkAround_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
