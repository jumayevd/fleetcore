-- Phone numbers in one format: a US / North American number reads "+1 (305) 555 0123" (src/lib/phone.ts, the same
-- rule). Numbers with another country code, of another length, or with letters (an extension) are kept as typed, with
-- spaces tidied. Applies to vendors, drivers (both phones), accounts and each company profile's phone.
CREATE FUNCTION fc_format_phone(p text) RETURNS text AS $$
DECLARE
  t text;
  d text;
  us text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  IF t = '' THEN RETURN p; END IF;
  d := regexp_replace(t, '\D', '', 'g');
  IF left(t, 1) = '+' THEN
    IF length(d) = 11 AND left(d, 1) = '1' THEN us := substr(d, 2); END IF;
  ELSIF length(d) = 10 THEN
    us := d;
  ELSIF length(d) = 11 AND left(d, 1) = '1' THEN
    us := substr(d, 2);
  END IF;
  IF us IS NULL OR t ~* '[a-z]' THEN RETURN t; END IF;
  RETURN '+1 (' || substr(us, 1, 3) || ') ' || substr(us, 4, 3) || ' ' || substr(us, 7);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "Vendor" SET "phone" = fc_format_phone("phone") WHERE "phone" IS DISTINCT FROM fc_format_phone("phone");
UPDATE "Driver" SET "phone" = fc_format_phone("phone") WHERE "phone" IS DISTINCT FROM fc_format_phone("phone");
UPDATE "Driver" SET "phone2" = fc_format_phone("phone2") WHERE "phone2" IS DISTINCT FROM fc_format_phone("phone2");
UPDATE "User" SET "phone" = fc_format_phone("phone") WHERE "phone" IS DISTINCT FROM fc_format_phone("phone");
UPDATE "AppSetting"
SET "value" = jsonb_set("value"::jsonb, '{phone}', to_jsonb(fc_format_phone("value"::jsonb ->> 'phone')))::text
WHERE "key" = 'company.profile'
  AND coalesce("value"::jsonb ->> 'phone', '') <> ''
  AND ("value"::jsonb ->> 'phone') IS DISTINCT FROM fc_format_phone("value"::jsonb ->> 'phone');

DROP FUNCTION fc_format_phone(text);
