-- Personal details for accounts: first and last name, ID number, date of birth.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "idNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "birthDate" DATE;
