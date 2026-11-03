-- Work lines use the repair types as their systems now (plus Labor and Miscellaneous). Older lines move to the
-- matching one where there is one; Cooling and HVAC stay as they are.
UPDATE "WorkOrderLine" SET "system" = CASE "system"
  WHEN 'PM' THEN 'OIL_CHANGE'
  WHEN 'EXHAUST' THEN 'DPF'
  WHEN 'FEES' THEN 'MISC'
  ELSE "system" END
WHERE "system" IN ('PM', 'EXHAUST', 'FEES');
