-- ===========================================================================
-- 17_booking_advance_limit.sql
-- How far ahead a NEW booking is allowed to reach shrinks as the lot fills
-- up: 8 hours when a pool (PWD or regular slots) is empty, down to 0 hours
-- (book now or not at all) once every slot in that pool has some live
-- reservation against it - 'cancelled'/'completed'/'no_show' don't count,
-- everything else does, whether it's happening right now or booked for
-- later today.
--
-- Computed separately for PWD and regular slots (different-sized, mostly
-- separate pools), but a PWD-verified customer gets whichever of the two is
-- more generous - they can already fall back to a non-PWD bay (the
-- slot-picking logic in assign_slot_for_reservation has always allowed
-- that), so PWD-specific fullness alone shouldn't block them from a regular
-- pool they can still reach.
--
-- CREATE OR REPLACE is enough for both functions - no DROP needed.
--
-- Safe to re-run.
-- ===========================================================================

-- get_booking_limits() -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_booking_limits()
RETURNS TABLE (pwd_max_hours NUMERIC, regular_max_hours NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MAX_ADVANCE_HOURS CONSTANT NUMERIC := 8;
  v_pwd_total     INTEGER;
  v_pwd_committed INTEGER;
  v_reg_total     INTEGER;
  v_reg_committed INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pwd_total FROM slots WHERE is_pwd = TRUE AND status <> 'maintenance';
  SELECT COUNT(*) INTO v_reg_total FROM slots WHERE is_pwd = FALSE AND status <> 'maintenance';

  SELECT COUNT(DISTINCT r.slot_id) INTO v_pwd_committed
  FROM reservations r JOIN slots s ON s.id = r.slot_id
  WHERE s.is_pwd = TRUE AND r.status NOT IN ('cancelled', 'completed', 'no_show');

  SELECT COUNT(DISTINCT r.slot_id) INTO v_reg_committed
  FROM reservations r JOIN slots s ON s.id = r.slot_id
  WHERE s.is_pwd = FALSE AND r.status NOT IN ('cancelled', 'completed', 'no_show');

  RETURN QUERY SELECT
    CASE WHEN v_pwd_total = 0 THEN 0::NUMERIC
         ELSE GREATEST(0, MAX_ADVANCE_HOURS * (1 - v_pwd_committed::NUMERIC / v_pwd_total)) END,
    CASE WHEN v_reg_total = 0 THEN 0::NUMERIC
         ELSE GREATEST(0, MAX_ADVANCE_HOURS * (1 - v_reg_committed::NUMERIC / v_reg_total)) END;
END;
$$;

-- assign_slot_for_reservation(vehicle, start, end) - same as live, plus the
-- new BOOKING_TOO_FAR_AHEAD check right after v_pwd is computed -----------
CREATE OR REPLACE FUNCTION assign_slot_for_reservation(
  p_vehicle_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MAX_DURATION_HOURS      CONSTANT NUMERIC := 24;
  PAST_TOLERANCE_MINUTES  CONSTANT INTEGER := 5;
  MAX_ATTEMPTS            CONSTANT INTEGER := 3;

  v_uid     UUID := auth.uid();
  v_owner   UUID;
  v_pwd     BOOLEAN;
  v_attempt INTEGER := 0;
  v_slot    RECORD;
  v_res     reservations;
  v_rate    NUMERIC;
  v_hours   NUMERIC;
  v_pwd_max_hours     NUMERIC;
  v_regular_max_hours NUMERIC;
  v_max_advance_hours NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT owner_id INTO v_owner FROM vehicles WHERE id = p_vehicle_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'VEHICLE_NOT_FOUND';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'NOT_YOUR_VEHICLE';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'INVALID_WINDOW';
  END IF;
  IF p_start < NOW() - (PAST_TOLERANCE_MINUTES * INTERVAL '1 minute') THEN
    RAISE EXCEPTION 'PAST_START';
  END IF;
  IF (p_end - p_start) > (MAX_DURATION_HOURS * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'TOO_LONG';
  END IF;

  IF has_unpaid_penalties(v_uid) THEN
    RAISE EXCEPTION 'UNPAID_PENALTIES';
  END IF;

  v_pwd := is_pwd_verified(v_uid);

  -- Shrinking advance-booking window: the fuller the lot, the less far
  -- ahead a NEW booking may reach - down to 0 hours (book now or not at
  -- all) once every slot in the applicable pool has some live reservation
  -- against it. A PWD-verified customer can already fall back to a
  -- non-PWD bay (the slot-picking WHERE clause below has always allowed
  -- that), so they get whichever pool's limit is more generous rather than
  -- being wrongly throttled by PWD-specific fullness alone when they can
  -- still reach the regular pool.
  SELECT pwd_max_hours, regular_max_hours INTO v_pwd_max_hours, v_regular_max_hours
  FROM get_booking_limits();
  v_max_advance_hours := CASE WHEN v_pwd THEN GREATEST(v_pwd_max_hours, v_regular_max_hours)
                               ELSE v_regular_max_hours END;

  IF p_start > NOW() + (v_max_advance_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'BOOKING_TOO_FAR_AHEAD';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    SELECT
      s.id, s.slot_code, s.is_pwd, s.floor, s.entry_rank
    INTO v_slot
    FROM slots s
    WHERE s.status <> 'maintenance'
      AND (v_pwd OR s.is_pwd = FALSE)
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.slot_id = s.id
          AND r.status NOT IN ('cancelled', 'completed', 'no_show')
          AND r.start_time < p_end
          AND r.end_time > p_start
      )
    ORDER BY
      CASE WHEN v_pwd AND s.is_pwd THEN 0 ELSE 1 END,  -- PWD customers: PWD bays first
      s.entry_rank NULLS LAST,                         -- then closest to the entrance
      s.slot_code
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN v_slot.id IS NULL;

    BEGIN
      INSERT INTO reservations (customer_id, vehicle_id, slot_id, start_time, end_time, status)
      VALUES (v_uid, p_vehicle_id, v_slot.id, p_start, p_end, 'pending')
      RETURNING * INTO v_res;

      EXIT;  -- inserted successfully
    EXCEPTION WHEN exclusion_violation THEN
      -- Someone took that slot between our SELECT and INSERT (SQLSTATE 23P01)
      IF v_attempt >= MAX_ATTEMPTS THEN
        RAISE EXCEPTION 'NO_SLOT_AVAILABLE';
      END IF;
      v_slot.id := NULL;  -- force another pass through the loop
    END;
  END LOOP;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'NO_SLOT_AVAILABLE';
  END IF;

  -- Extra, phone-facing confirmation on top of the trigger's own message.
  PERFORM create_notification(
    v_uid,
    'Slot assigned',
    'You are assigned slot ' || v_slot.slot_code || ' on floor ' || v_slot.floor ||
      '. Booking ' || v_res.booking_code || '.',
    'reservation',
    v_res.id
  );

  PERFORM log_audit(
    v_uid,
    'slot_assigned',
    jsonb_build_object(
      'reservation_id', v_res.id,
      'booking_code', v_res.booking_code,
      'slot_id', v_slot.id,
      'slot_code', v_slot.slot_code,
      'start_time', p_start,
      'end_time', p_end
    )
  );

  SELECT hourly_rate INTO v_rate FROM rates ORDER BY updated_at DESC LIMIT 1;
  v_hours := EXTRACT(EPOCH FROM (p_end - p_start)) / 3600;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'booking_code', v_res.booking_code,
    'slot_id', v_slot.id,
    'slot_code', v_slot.slot_code,
    'floor', v_slot.floor,
    'start_time', p_start,
    'end_time', p_end,
    'estimated_charge', CEIL(v_hours) * COALESCE(v_rate, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION get_booking_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_booking_limits() TO authenticated;

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT * FROM get_booking_limits();
-- Expected: two rows worth of info in one row - pwd_max_hours and
-- regular_max_hours, each between 0 and 8 depending on current fullness.
-- On a freshly-seeded/empty database both should read 8.
