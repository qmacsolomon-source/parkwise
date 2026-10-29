-- ===========================================================================
-- ParkWise - LIVE upgrade - 25_demo_occupancy_seeding.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Adds two functions for staging a presentation/demo, so the lot can be
--   shown going from empty to full and the advance-booking window (the
--   "book up to N hours ahead" notice on the Reserve screen/Dashboard,
--   driven by get_booking_limits()'s MAX_ADVANCE_HOURS * (1 - committed/total)
--   formula) visibly shrinks as it fills:
--
--   - seed_demo_occupancy(p_count) ALWAYS starts by destroying every demo
--     row the previous call created (same as calling clear_demo_occupancy()
--     first), then seeds up to p_count fresh fake reservations on RANDOM
--     slots - ALL non-maintenance slots, PWD included, since this is purely
--     a visual demo and not meant to enforce the real PWD-booking policy.
--     Changing the number between runs - 5, then 100, then back down to 20
--     - never layers on top of the last run or leaves old leftovers mixed
--     in with the new target; every call is a full reset to exactly that
--     count. Each fake reservation gets its own fake customer + vehicle (no
--     auth.users row needed - same trick Manual Entry already uses for
--     walk-ins) and a randomized, staggered start/end time, so the floor
--     plan and the "Opening soon" list both look like a real mixed lot, not
--     a wall of identical entries.
--
--     A minimum of ~2% of all slots (at least 3) is ALWAYS left unseeded,
--     no matter how high p_count is - a lot that's literally 100% full
--     everywhere, with zero vacancy anywhere, reads as artificial rather
--     than like a real parking lot. "3 slots left" style near-full demo
--     beats still work fine (asking for exactly total-3 lands right at
--     this floor); it's only a request that would leave ZERO vacancy that
--     gets pulled back.
--   - clear_demo_occupancy() deletes every fake profile this created (and
--     everything that cascades from it - vehicles, reservations, penalties,
--     payments, notifications, audit_log), leaving the lot empty. Only
--     ever touches rows tagged with the demo email pattern below - never a
--     real customer. seed_demo_occupancy() calls this itself; call it on
--     its own when you just want to clear without reseeding.
--
--   Goes through the exact same INSERT/UPDATE path and triggers a real
--   booking would (update_slot_status, refresh_booking_limits_cache,
--   create_penalty_on_status_change, notify_reservation_*, audit) - nothing
--   bypassed, so booking_limits_cache (and anything subscribed to it, like
--   the mobile app's live notice) updates exactly as it would for a real
--   customer.
--
-- WHY THE EARLIER VERSION LOOKED "NOT RANDOM"
--   It filtered is_pwd = FALSE, intending to only hand regular (non-PWD)
--   bays to the fake demo customers. On this lot, is_pwd turns out to be
--   TRUE for far more slots than the floor plan draws a wheelchair icon
--   for (only shows the icon in each floor's first row) - so excluding
--   them left the SAME columns white on every single row, on every floor,
--   every time: a repeating structural pattern, not randomness, and with
--   a count like 150 capped down to the true regular total (117) and
--   fully filled, there was also zero vacancy anywhere else to break it
--   up. Both are fixed by seeding the whole lot (PWD included) and never
--   allowing a full-vacancy-zero fill.
--
-- HOW TO USE (paste each block into Supabase, in order, during the demo)
--   -- Stage 1 (car #1): empty lot -> ~8 hours ahead.
--   SELECT * FROM seed_demo_occupancy(0);
--
--   -- Stage 2 (car #2): lot half full -> ~4 hours ahead (half of 8).
--   -- Destroys stage 1's data first, then seeds fresh.
--   SELECT * FROM seed_demo_occupancy(
--     (SELECT COUNT(*) / 2 FROM slots WHERE status <> 'maintenance')
--   );
--
--   -- Stage 3 (car #3): only ~3 slots left free -> a few minutes ahead.
--   -- Destroys stage 2's data first, then seeds fresh.
--   SELECT * FROM seed_demo_occupancy(
--     (SELECT COUNT(*) FROM slots WHERE status <> 'maintenance') - 3
--   );
--
--   -- Afterward (or before a practice re-run): wipe it all clean, no reseed.
--   SELECT * FROM clear_demo_occupancy();
--
-- WHAT IT NEEDS
--   slots, reservations, profiles, vehicles - all already in place since
--   schema.sql/business_rules.sql.
--
-- SAFE TO RUN TWICE: CREATE SEQUENCE IF NOT EXISTS / CREATE OR REPLACE.
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS demo_seed_seq;

CREATE OR REPLACE FUNCTION clear_demo_occupancy()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM profiles WHERE email LIKE 'demo-%@parkwise.invalid';

  -- Cascades through vehicles/reservations/penalties/payments/notifications/
  -- audit_log - every one of those FKs back to profiles.id ON DELETE CASCADE
  -- (same as every other place in this schema that hangs data off a
  -- customer). Only ever matches the demo-% email pattern seed_demo_
  -- occupancy() itself used - never a real customer's row.
  DELETE FROM profiles WHERE email LIKE 'demo-%@parkwise.invalid';

  RETURN v_count;
END;
$$;

-- DROP first, not just CREATE OR REPLACE: Postgres refuses to REPLACE a
-- function whose RETURNS TABLE column names changed (42P13: cannot change
-- return type of existing function) - hit live when this went from
-- total_regular_slots to total_slots. Drop+recreate is safe regardless of
-- whether an older version is installed at all.
DROP FUNCTION IF EXISTS seed_demo_occupancy(INTEGER);

CREATE OR REPLACE FUNCTION seed_demo_occupancy(p_count INTEGER)
RETURNS TABLE (
  total_slots INTEGER,
  cleared INTEGER,
  newly_added INTEGER,
  now_committed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total       INTEGER;
  v_min_vacant  INTEGER;
  v_cap         INTEGER;
  v_cleared     INTEGER;
  v_needed      INTEGER;
  v_added       INTEGER := 0;
  v_after       INTEGER;
  v_slot        RECORD;
  v_seq         BIGINT;
  v_profile     UUID;
  v_vehicle     UUID;
  v_res         UUID;
  v_status      TEXT;
  v_start       TIMESTAMPTZ;
  v_end         TIMESTAMPTZ;
  v_roll        NUMERIC;
BEGIN
  -- Always a full reset first, never a top-up - changing the count between
  -- demo runs (5 -> 100, 100 -> 20) used to leave the EARLIER run's rows
  -- mixed in with the new target, which could leave more slots committed
  -- than the number actually asked for and made the on-screen numbers hard
  -- to reason about. Every call now starts from exactly zero demo rows.
  v_cleared := clear_demo_occupancy();

  -- ALL non-maintenance slots, PWD included - see "WHY THE EARLIER VERSION
  -- LOOKED NOT RANDOM" above. This is a visual demo, not a real booking -
  -- the real PWD-only policy is still enforced for genuine customers by
  -- assign_slot_for_reservation(), untouched by this.
  SELECT COUNT(*) INTO v_total FROM slots WHERE status <> 'maintenance';

  -- Never let a request fill every last slot - always leave at least ~2%
  -- (minimum 3) genuinely vacant, no matter how high p_count is, so the
  -- lot still looks like a real one even at "almost full". A request for
  -- exactly total-3 (the "3 slots left" demo beat) lands right at this
  -- floor and is unaffected; only a request that would leave ZERO vacancy
  -- gets pulled back.
  v_min_vacant := GREATEST(3, FLOOR(v_total * 0.02)::INTEGER);
  v_cap := GREATEST(v_total - v_min_vacant, 0);
  v_needed := LEAST(GREATEST(p_count, 0), v_cap);

  FOR v_slot IN
    SELECT s.id FROM slots s
    WHERE s.status <> 'maintenance'
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.slot_id = s.id
          AND r.status NOT IN ('cancelled', 'completed', 'no_show')
      )
    ORDER BY random()
    LIMIT v_needed
  LOOP
    v_seq := nextval('demo_seed_seq');

    -- Fake customer - no auth.users row at all, same as Manual Entry's
    -- walk-ins. Tagged with the demo-% email pattern so
    -- clear_demo_occupancy() can find and remove exactly these later,
    -- never a real customer. pwd_verified = TRUE unconditionally: since
    -- the pool now includes PWD slots (see "WHY THE EARLIER VERSION
    -- LOOKED NOT RANDOM" above), check_pwd_slot_access()'s BEFORE INSERT
    -- trigger on reservations rejects any non-PWD-verified customer on a
    -- PWD slot - confirmed live (P0001 "PWD slots can only be reserved by
    -- accounts with PWD verification") the first time the random pick
    -- landed on one. Harmless on a fake, demo-only profile nobody else
    -- ever sees.
    INSERT INTO profiles (full_name, email, phone, role, pwd_verified)
    VALUES ('Demo Customer ' || v_seq, 'demo-' || v_seq || '@parkwise.invalid', '', 'customer', TRUE)
    RETURNING id INTO v_profile;

    INSERT INTO vehicles (owner_id, plate_number, vehicle_type, is_default)
    VALUES (v_profile, 'DEM' || lpad((v_seq % 10000)::text, 4, '0'), 'four_wheeled', TRUE)
    RETURNING id INTO v_vehicle;

    -- Mostly 'verified' (camera-confirmed - the main "the lot has real
    -- parked cars" visual), some 'active' (checked in, awaiting
    -- verification) and a rare 'overstay' (so the Alerts counter on Live
    -- Occupancy has something to show too).
    v_roll := random();
    v_status := CASE
      WHEN v_roll < 0.70 THEN 'verified'
      WHEN v_roll < 0.90 THEN 'active'
      ELSE 'overstay'
    END;

    IF v_status = 'overstay' THEN
      -- Started 2-4h ago, booked window already ended 0-30 min ago - the
      -- car is still there, past its booked time.
      v_start := NOW() - (2 + random() * 2) * INTERVAL '1 hour';
      v_end := NOW() - (random() * 30) * INTERVAL '1 minute';
    ELSE
      -- Started 0-1h ago, 1-8h of booked time left - staggered so
      -- clearing times vary instead of every demo car ending at once
      -- (this is also what the "Opening soon" list on Reserve picks up).
      v_start := NOW() - (random() * 60) * INTERVAL '1 minute';
      v_end := v_start + (1 + random() * 7) * INTERVAL '1 hour';
    END IF;

    -- Always INSERT as 'pending' first, THEN UPDATE to the target status -
    -- update_slot_status()'s INSERT branch always sets the slot 'reserved'
    -- regardless of the row's own status, so going straight to 'verified'/
    -- 'overstay' in the INSERT itself would leave the SLOT still showing
    -- 'reserved' even though the reservation says otherwise. The follow-up
    -- UPDATE is what actually drives the slot - and booking_limits_cache,
    -- penalties, notifications, audit_log, every trigger a REAL booking
    -- would fire - to the state this demo car is meant to simulate.
    INSERT INTO reservations (customer_id, vehicle_id, slot_id, start_time, end_time, status, booking_code)
    VALUES (v_profile, v_vehicle, v_slot.id, v_start, v_end, 'pending', 'DEMO-' || v_seq)
    RETURNING id INTO v_res;

    -- Explicit cast required: v_status is a TEXT variable, not a string
    -- literal, so Postgres won't implicitly coerce it to the
    -- reservation_status enum column the way a bare 'verified' literal
    -- would be - confirmed live (42804: column "status" is of type
    -- reservation_status but expression is of type text).
    UPDATE reservations SET status = v_status::reservation_status WHERE id = v_res;

    v_added := v_added + 1;
  END LOOP;

  SELECT COUNT(DISTINCT r.slot_id) INTO v_after
  FROM reservations r
  WHERE r.status NOT IN ('cancelled', 'completed', 'no_show');

  RETURN QUERY SELECT v_total, v_cleared, v_added, v_after;
END;
$$;

REVOKE ALL ON FUNCTION seed_demo_occupancy(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION clear_demo_occupancy() FROM PUBLIC, anon, authenticated;
-- Deliberately no GRANT to any app-facing role - this only ever runs pasted
-- directly into the Supabase SQL editor (as postgres, which bypasses grants
-- anyway), never from the desktop or mobile app.

-- ---------------------------------------------------------------------------
-- Check (read-only)
-- ---------------------------------------------------------------------------
-- SELECT * FROM get_booking_limits();
-- Expected: regular_max_hours reads ~8 when empty, ~4 at half full, and a
-- small number of hours (a few minutes' worth) once near-full. Also look
-- at the floor plan itself - vacant slots should now be scattered randomly
-- across all three floors, not clustered in the same columns every time.
