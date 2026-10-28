-- Platform owners (run FleetCore without belonging to a company) and one-time links to set a password.
ALTER TABLE "User" ADD COLUMN "platformRole" TEXT;

CREATE TABLE "PasswordLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordLink_tokenHash_key" ON "PasswordLink"("tokenHash");
CREATE INDEX "PasswordLink_userId_idx" ON "PasswordLink"("userId");

ALTER TABLE "PasswordLink" ADD CONSTRAINT "PasswordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
