-- The audit log keeps every change for good.

-- 1. Deleting a company no longer deletes its history: the foreign key (ON DELETE CASCADE) goes, the id stays.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_companyId_fkey";

-- 2. An account that made changes can't be deleted (it is deactivated instead), so "who" is never lost.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Entries can be added, never changed or removed, whatever the app (or a mistake in it) asks.
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only: its entries cannot be changed or deleted';
END;
$$;
CREATE TRIGGER "AuditLog_no_update_delete" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();
