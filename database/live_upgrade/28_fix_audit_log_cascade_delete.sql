-- ===========================================================================
-- ParkWise - LIVE upgrade - 28_fix_audit_log_cascade_delete.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Fixes a confirmed bug: deleting a customer profile that still has its
--   own reservations attached (reservations.customer_id ON DELETE CASCADE)
--   failed outright with a foreign key violation:
--
--     ERROR: 23503: insert or update on table "audit_log" violates foreign
--     key constraint "audit_log_actor_id_fkey"
--     DETAIL: Key (actor_id)=(...) is not present in table "profiles".
--
--   audit_reservation_changes()'s DELETE branch unconditionally calls
--   log_audit(OLD.customer_id, 'reservation_deleted', ...) for every
--   reservation the cascade removes. When the delete is happening BECAUSE
--   the customer themselves is being deleted in the same statement, that
--   customer_id no longer resolves to a real profiles row by the time this
--   fires - audit_log.actor_id references profiles(id) with no ON DELETE
--   SET NULL, so the INSERT this trigger makes fails, and the failure
--   rolls back the entire DELETE (including the profile itself).
--
--   This was a latent bug nothing had ever exercised before -
--   clear_demo_occupancy() (25_demo_occupancy_seeding.sql) is the first
--   thing in this app that actually deletes a customer profile with their
--   own reservations still live. Fixed by only logging when the customer
--   still exists.
--
-- WHAT IT NEEDS
--   reservations, profiles, audit_log, log_audit() - all already in place
--   since business_rules.sql.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE.
-- ===========================================================================

CREATE OR REPLACE FUNCTION audit_reservation_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_audit(
      NEW.customer_id,
      'reservation_created',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'booking_code', NEW.booking_code,
        'slot_id', NEW.slot_id,
        'start_time', NEW.start_time,
        'end_time', NEW.end_time
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM log_audit(
        NEW.customer_id,
        'reservation_status_changed',
        jsonb_build_object(
          'reservation_id', NEW.id,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only log if the customer still exists - a reservation can also be
    -- deleted as a CASCADE side effect of the customer's own profile row
    -- being deleted in the same statement (clear_demo_occupancy(), or any
    -- future "really delete this customer" admin action). In that case
    -- OLD.customer_id no longer resolves to a real profiles row by the
    -- time this fires, and log_audit()'s INSERT into audit_log (actor_id
    -- REFERENCES profiles(id), no ON DELETE SET NULL) raises a foreign key
    -- violation and rolls back the whole delete - confirmed live (23503 on
    -- audit_log_actor_id_fkey) the first time anything in this app
    -- actually deleted a customer with their own reservations still
    -- attached.
    IF EXISTS (SELECT 1 FROM profiles WHERE id = OLD.customer_id) THEN
      PERFORM log_audit(
        OLD.customer_id,
        'reservation_deleted',
        jsonb_build_object('reservation_id', OLD.id, 'booking_code', OLD.booking_code)
      );
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Check (read-only, after this is applied)
-- ---------------------------------------------------------------------------
-- SELECT * FROM clear_demo_occupancy();
-- Expected: succeeds and returns the count deleted, no 23503 error.
