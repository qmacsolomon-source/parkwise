-- ===========================================================================
-- ParkWise - LIVE upgrade - 27_fix_slot_reassign_status.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Fixes a confirmed bug: reassigning a reservation to a different slot -
--   via mobile's "Change slot" (change_reservation_slot()) or the desktop's
--   Slot Assignment "Reassign" - never showed up on the attendant side.
--
--   update_slot_status()'s UPDATE branch only ever looked at NEW.slot_id,
--   never OLD.slot_id, so the slot a reservation moved AWAY FROM kept
--   showing 'reserved'/'occupied' forever. Worse, the branch had no case
--   for NEW.status = 'pending' at all - the normal status right after a
--   mobile booking, before any attendant ever touches it - so reassigning a
--   still-pending reservation updated NEITHER slot's row: the new slot kept
--   reading 'available' and the old one kept reading taken, with nothing on
--   Live Occupancy or Slot Assignment ever reflecting the move, no matter
--   how long you waited or how many times you refreshed.
--
--   Now: whenever OLD.slot_id IS DISTINCT FROM NEW.slot_id, the old slot is
--   freed unconditionally first; and 'pending' is handled the same as
--   'active' (both mean "booked, not yet camera-verified" -> slot shows
--   'reserved').
--
-- WHAT IT NEEDS
--   slots, reservations, the trg_reservation_update_slot trigger - all
--   already in place since business_rules.sql.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE.
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_slot_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- When reservation is created, mark slot as reserved
    UPDATE slots SET status = 'reserved', current_reservation_id = NEW.id
    WHERE id = NEW.slot_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- The reservation moved to a DIFFERENT slot (mobile's "Change slot" /
    -- change_reservation_slot(), or Slot Assignment's Reassign) - free the
    -- OLD slot first, unconditionally, regardless of what NEW.status ends
    -- up being below. Previously nothing here ever looked at OLD.slot_id at
    -- all, so the slot a reservation moved AWAY FROM kept showing
    -- 'reserved'/'occupied' forever on the attendant side. Combined with
    -- 'pending' having no branch at all below (now fixed), reassigning a
    -- reservation that was still 'pending' - the normal case right after
    -- booking, before an attendant ever touches it - used to update
    -- NEITHER slot's row: the new slot kept showing 'available' and the
    -- old one kept showing taken, with nothing on Live Occupancy or Slot
    -- Assignment ever reflecting the move.
    IF OLD.slot_id IS DISTINCT FROM NEW.slot_id THEN
      UPDATE slots SET status = 'available', current_reservation_id = NULL
      WHERE id = OLD.slot_id;
    END IF;

    -- Update slot status based on reservation status
    IF NEW.status = 'pending' OR NEW.status = 'active' THEN
      -- 'pending': booked, not yet administratively accepted. 'active':
      -- administratively checked in (Slot Assignment's Accept Vehicle), not
      -- yet camera-verified. Both keep the slot 'reserved', not 'occupied' -
      -- 'occupied' is reserved to mean "the camera confirmed the plate,"
      -- which only happens once status reaches 'verified' below, not just
      -- because a booking exists or an attendant clicked accept.
      UPDATE slots SET status = 'reserved', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'verified' THEN
      UPDATE slots SET status = 'occupied', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'completed' OR NEW.status = 'cancelled' OR NEW.status = 'no_show' THEN
      UPDATE slots SET status = 'available', current_reservation_id = NULL
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'overstay' THEN
      UPDATE slots SET status = 'overstay', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- When reservation is deleted, free up the slot
    UPDATE slots SET status = 'available', current_reservation_id = NULL
    WHERE id = OLD.slot_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Check (after reassigning a pending reservation to a new slot)
-- ---------------------------------------------------------------------------
-- SELECT slot_code, status, current_reservation_id FROM slots WHERE id IN (<old slot id>, <new slot id>);
-- Expected: the OLD slot reads 'available' with current_reservation_id NULL,
-- the NEW slot reads 'reserved' with current_reservation_id = the
-- reservation's id - immediately, without needing any other action.
