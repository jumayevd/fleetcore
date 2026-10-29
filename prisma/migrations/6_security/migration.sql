-- Sign-ins from before a password change stop counting.
ALTER TABLE "User" ADD COLUMN     "sessionsValidFrom" TIMESTAMP(3);

-- Wrong-password counts for the sign-in lock.
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "lockedUntil" TIMESTAMPTZ(3),

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);
