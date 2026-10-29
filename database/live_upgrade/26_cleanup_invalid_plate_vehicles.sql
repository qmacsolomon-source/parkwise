-- ===========================================================================
-- ParkWise - LIVE upgrade - 26_cleanup_invalid_plate_vehicles.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   vehicles_plate_format_check was briefly loosened to accept digits-first
--   plates (e.g. 123NAA) and then reverted back to letters-first-only
--   (ABC1234). The revert used NOT VALID, which only skips the ONE-TIME
--   validation sweep over EXISTING rows at ALTER TABLE time - it does NOT
--   exempt those rows from the constraint on any future write. Postgres
--   re-checks a CHECK constraint against the WHOLE row on every UPDATE, not
--   just the column being changed, so any grandfathered invalid-format
--   vehicle (123NAA) started failing on completely unrelated updates -
--   concretely, setDefaultVehicle() clears is_default on every vehicle a
--   customer owns in one statement, which touches 123NAA's row too and
--   trips the constraint even though nothing about its plate was involved.
--
--   For every vehicle whose plate_number doesn't match the current format:
--   - No reservation history -> DELETE outright (a DELETE never re-checks
--     CHECK constraints, so this always succeeds regardless of format).
--   - Has reservation history -> can't hard-delete (reservations.vehicle_id
--     is ON DELETE RESTRICT, specifically to protect booking history), so
--     it's archived instead (is_active=false, is_default=false) - same as
--     a normal "delete a used vehicle" would do - AND given a placeholder
--     letters-first plate (ARC0001, ARC0002, ...) in the SAME statement,
--     since otherwise this exact UPDATE would hit the exact same error
--     this script exists to fix.
--
-- WHAT IT NEEDS
--   vehicles, reservations - already in place.
--
-- SAFE TO RUN TWICE: the WHERE clause only ever matches rows that still
-- have an invalid format: once cleaned up, re-running finds nothing to do.
-- ===========================================================================

DO $$
DECLARE
  v_row RECORD;
  v_has_history BOOLEAN;
  v_seq INTEGER := 0;
  v_deleted INTEGER := 0;
  v_archived INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, plate_number FROM vehicles
    WHERE plate_number !~ '^[A-Z]{3}[0-9]{3,4}$'
  LOOP
    SELECT EXISTS (SELECT 1 FROM reservations WHERE vehicle_id = v_row.id) INTO v_has_history;

    IF v_has_history THEN
      v_seq := v_seq + 1;
      UPDATE vehicles
      SET is_active = false,
          is_default = false,
          plate_number = 'ARC' || lpad(v_seq::text, 4, '0')
      WHERE id = v_row.id;
      v_archived := v_archived + 1;
      RAISE NOTICE 'Archived % (had reservation history) - renamed to ARC%.', v_row.plate_number, lpad(v_seq::text, 4, '0');
    ELSE
      DELETE FROM vehicles WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
      RAISE NOTICE 'Deleted % (no reservation history).', v_row.plate_number;
    END IF;
  END LOOP;

  RAISE NOTICE 'Done: % deleted, % archived.', v_deleted, v_archived;
END $$;

-- ---------------------------------------------------------------------------
-- Check (read-only)
-- ---------------------------------------------------------------------------
-- SELECT plate_number, is_active FROM vehicles WHERE plate_number !~ '^[A-Z]{3}[0-9]{3,4}$';
-- Expected: zero rows - nothing left with an invalid plate format.
