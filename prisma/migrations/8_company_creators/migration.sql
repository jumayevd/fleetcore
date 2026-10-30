-- Who may create new companies: platform owners always, other accounts only with this flag.
ALTER TABLE "User" ADD COLUMN "canCreateCompanies" BOOLEAN NOT NULL DEFAULT false;
