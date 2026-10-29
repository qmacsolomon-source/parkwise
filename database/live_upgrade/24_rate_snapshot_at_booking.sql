-- ===========================================================================
-- ParkWise - LIVE upgrade - 24_rate_snapshot_at_booking.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Fixes a confirmed billing bug: RatesAndPricing.tsx tells the attendant
--   "New rates will only apply to future reservations. Existing
--   reservations will continue to use the rates that were in effect at the
--   time of booking" - but `reservations` never actually captured a rate at
--   all, and CashPayment.tsx always read the live `rates` row at payment
--   time. Changing rates mid-day silently re-priced every in-flight booking.
--
--   Adds reservations.rate_snapshot (JSONB: hourly_rate, overstay_per_hour,
--   grace_period_minutes), filled in by assign_slot_for_reservation() the
--   moment a booking is created, and used by calculate_payment() (and by
--   CashPayment.tsx / the desktop app, which has its own equivalent fix)
--   instead of the live `rates` row whenever it's present.
--
-- WHAT IT NEEDS
--   `reservations`, `rates` - both already in place since schema.sql.
--
-- SAFE TO RUN TWICE: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.
-- EXISTING ROWS: rate_snapshot stays NULL for reservations booked before
-- this runs - calculate_payment() and CashPayment.tsx both fall back to the
-- live `rates` row for those, same as they always did.
-- ===========================================================================

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rate_snapshot JSONB;

-- ---------------------------------------------------------------------------
-- assign_slot_for_reservation(vehicle, start, end) - now captures rate_snapshot
-- ---------------------------------------------------------------------------
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
  v_rate    RECORD;
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

  SELECT pwd_max_hours, regular_max_hours INTO v_pwd_max_hours, v_regular_max_hours
  FROM get_booking_limits();
  v_max_advance_hours := CASE WHEN v_pwd THEN GREATEST(v_pwd_max_hours, v_regular_max_hours)
                               ELSE v_regular_max_hours END;

  IF p_start > NOW() + (v_max_advance_hours * INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'BOOKING_TOO_FAR_AHEAD';
  END IF;

  -- Captured now, before the slot is even picked, and stored on the
  -- reservation itself (rate_snapshot below) so a later rate change
  -- (RatesAndPricing.tsx) can never retroactively change what THIS booking
  -- is billed - CashPayment.tsx uses this snapshot instead of the live
  -- `rates` row. Previously nothing captured this at all, so the on-screen
  -- promise that "existing reservations keep the rate in effect at booking
  -- time" was simply false - every payment used whatever rate was live at
  -- checkout, regardless of when the booking was made.
  SELECT * INTO v_rate FROM rates ORDER BY updated_at DESC LIMIT 1;

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
      INSERT INTO reservations (customer_id, vehicle_id, slot_id, start_time, end_time, status, rate_snapshot)
      VALUES (
        v_uid, p_vehicle_id, v_slot.id, p_start, p_end, 'pending',
        jsonb_build_object(
          'hourly_rate', v_rate.hourly_rate,
          'overstay_per_hour', v_rate.overstay_per_hour,
          'grace_period_minutes', v_rate.grace_period_minutes
        )
      )
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

  v_hours := EXTRACT(EPOCH FROM (p_end - p_start)) / 3600;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'booking_code', v_res.booking_code,
    'slot_id', v_slot.id,
    'slot_code', v_slot.slot_code,
    'floor', v_slot.floor,
    'start_time', p_start,
    'end_time', p_end,
    'estimated_charge', CEIL(v_hours) * COALESCE(v_rate.hourly_rate, 0)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- calculate_payment(reservation) - now prefers the reservation's own snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_payment(
  reservation_uuid UUID
)
RETURNS JSONB AS $$
DECLARE
  res RECORD;
  rate RECORD;
  duration_hours NUMERIC;
  base_charge NUMERIC;
  overstay_hours NUMERIC;
  overstay_surcharge NUMERIC;
  penalty_total NUMERIC;
  total NUMERIC;
BEGIN
  SELECT * INTO res FROM reservations WHERE id = reservation_uuid;
  SELECT * INTO rate FROM rates ORDER BY updated_at DESC LIMIT 1;

  -- Bill using the rate captured on THIS reservation at booking time
  -- (assign_slot_for_reservation()), not whatever's live on `rates` right
  -- now - same reasoning, and same fallback for pre-existing rows with no
  -- snapshot yet, as CashPayment.tsx's calculatePayment().
  IF res.rate_snapshot IS NOT NULL THEN
    rate.hourly_rate := (res.rate_snapshot->>'hourly_rate')::NUMERIC;
    rate.overstay_per_hour := (res.rate_snapshot->>'overstay_per_hour')::NUMERIC;
    rate.grace_period_minutes := (res.rate_snapshot->>'grace_period_minutes')::INTEGER;
  END IF;

  -- Calculate duration
  duration_hours := EXTRACT(EPOCH FROM (res.end_time - res.start_time)) / 3600;

  -- Base charge
  base_charge := CEIL(duration_hours) * rate.hourly_rate;

  -- Overstay calculation (if status is overstay)
  overstay_hours := 0;
  overstay_surcharge := 0;
  IF res.status = 'overstay' THEN
    IF NOW() > (res.end_time + (rate.grace_period_minutes * INTERVAL '1 minute')) THEN
      overstay_hours := EXTRACT(EPOCH FROM (NOW() - res.end_time)) / 3600;
      overstay_surcharge := CEIL(overstay_hours) * rate.overstay_per_hour;
    END IF;
  END IF;

  -- Calculate penalties
  SELECT COALESCE(SUM(amount), 0) INTO penalty_total
  FROM penalties
  WHERE reservation_id = reservation_uuid AND status = 'unpaid';

  -- Total
  total := base_charge + overstay_surcharge + penalty_total;

  RETURN jsonb_build_object(
    'base_charge', base_charge,
    'overstay_surcharge', overstay_surcharge,
    'penalty_total', penalty_total,
    'total', total,
    'duration_hours', duration_hours,
    'overstay_hours', overstay_hours
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Check (read-only)
-- ---------------------------------------------------------------------------
-- SELECT rate_snapshot FROM reservations ORDER BY created_at DESC LIMIT 5;
-- Expected: every NEW booking from now on has a non-null rate_snapshot with
-- hourly_rate/overstay_per_hour/grace_period_minutes matching whatever
-- `rates` row was live at the moment it was created.
