-- Archived companies keep every row; see Company.archivedAt.
ALTER TABLE "Company" ADD COLUMN "archivedAt" TIMESTAMP(3);
