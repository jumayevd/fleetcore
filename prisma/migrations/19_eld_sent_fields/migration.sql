-- The data fields the ELD sent at the last sync (names only), so Settings → Integrations shows which readings
-- (odometer, fuel, engine hours) this account's TrackPro provides.
ALTER TABLE "EldConnection" ADD COLUMN "sentFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
