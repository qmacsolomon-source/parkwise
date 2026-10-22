-- ===========================================================================
-- 16_occupied_means_verified.sql
-- "Occupied" on the Slot Map should mean the camera actually confirmed the
-- plate (reservations.status = 'verified'), not just that an attendant
-- clicked Accept Vehicle on Slot Assignment (reservations.status = 'active').
-- Previously update_slot_status() treated both the same, so a slot went
-- 'occupied' the moment it was administratively checked in - before the
-- camera had looked at it at all.
--
-- CREATE OR REPLACE FUNCTION is enough here (unlike 15's EXCLUDE constraint,
-- a trigger function can just be redefined in place).
--
-- Safe to re-run: CREATE OR REPLACE.
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
    -- Update slot status based on reservation status
    IF NEW.status = 'active' THEN
      -- Administratively checked in (Slot Assignment's Accept Vehicle), not
      -- yet camera-verified. Keep the slot 'reserved', not 'occupied' -
      -- 'occupied' is reserved to mean "the camera confirmed the plate,"
      -- which only happens once status reaches 'verified' below, not just
      -- because an attendant clicked accept.
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
-- Check
-- ---------------------------------------------------------------------------
-- SELECT pg_get_functiondef('update_slot_status()'::regprocedure) LIKE '%reserved%occupied%';
-- Simpler manual check: accept a vehicle on Slot Assignment (reservations.status
-- becomes 'active') and confirm the slot shows 'reserved', not 'occupied', until
-- Plate Verification's Accept Vehicle actually verifies the plate.
