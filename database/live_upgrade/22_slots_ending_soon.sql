-- ===========================================================================
-- ParkWise - LIVE upgrade - 22_slots_ending_soon.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Adds get_slots_ending_soon(p_within_minutes), a read-only function the
--   phone calls to show customers "opening soon" bays on the Reserve screen -
--   occupied slots whose booked window ends within the next N minutes, plus
--   any slot that's already gone past its booked end_time (status =
--   'overstay') and so could clear at any moment with no real ETA at all.
--
--   SECURITY DEFINER, same reasoning as get_floor_plan(): it has to see
--   every customer's live reservation to know which slots are ending soon,
--   but only ever returns the slot and a timestamp - never a plate, name or
--   reservation id. This is informational only (helps a customer pick WHEN
--   to try booking), not a picker - assign_slot_for_reservation() still
--   decides which bay an actual booking lands on.
--
-- WHAT IT NEEDS
--   slots(id, slot_code, floor, is_pwd), reservations(slot_id, status,
--   end_time) - both already in place since 03_floor_plan_207.sql.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE / REVOKE+GRANT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_slots_ending_soon(p_within_minutes INTEGER DEFAULT 60)
RETURNS TABLE (
  slot_id UUID,
  slot_code TEXT,
  floor SMALLINT,
  is_pwd BOOLEAN,
  ends_at TIMESTAMPTZ,
  overdue BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.slot_code,
    s.floor,
    s.is_pwd,
    r.end_time,
    (r.status = 'overstay')
  FROM reservations r
  JOIN slots s ON s.id = r.slot_id
  WHERE r.status IN ('active', 'verified', 'overstay')
    -- Only the reservation actually covering right now - without this, a
    -- slot with Round 81's "accept up to 3 min before start" already
    -- pressed for the NEXT customer has two non-overlapping rows both
    -- satisfying the end_time check (the overlap EXCLUDE constraint only
    -- blocks overlapping ranges on the same slot, not back-to-back ones),
    -- so the same slot_code would come back twice with two different ETAs.
    AND r.start_time <= NOW()
    -- Don't show a customer their own booking as if it were "opening up" -
    -- IS DISTINCT FROM so an unauthenticated/NULL auth.uid() (shouldn't
    -- happen given the GRANT below, but cheap to be safe) excludes nothing.
    AND r.customer_id IS DISTINCT FROM v_uid
    AND (
      r.status = 'overstay'
      OR r.end_time BETWEEN NOW() AND NOW() + (p_within_minutes * INTERVAL '1 minute')
    )
  -- Scheduled-ending-soon rows first (the actionable ones), overstay rows
  -- (no real ETA at all) last - so a lot with many overstays can't push the
  -- more useful scheduled rows out past the LIMIT below.
  ORDER BY (r.status = 'overstay') ASC, r.end_time ASC
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION get_slots_ending_soon(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_slots_ending_soon(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Check (read-only)
-- ---------------------------------------------------------------------------
-- SELECT * FROM get_slots_ending_soon(60);
-- Expected: only OTHER customers' slots currently 'active'/'verified'/
-- 'overstay', ordered soonest-ending-first then overdue-last, never more
-- than 10 rows, never a row whose start_time is still in the future.
