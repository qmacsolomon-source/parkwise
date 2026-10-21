-- ParkWise: floor plan geometry + automatic slot assignment
-- ---------------------------------------------------------------------------
-- ONE idempotent file. Run the whole thing in the Supabase SQL Editor.
-- If this fails, only the FIRST error matters; the rest are fallout.
-- (Everything below runs inside one BEGIN; ... COMMIT;, so the first failure
-- aborts the transaction and every later statement reports "current
-- transaction is aborted" instead of its own error. Fix the first one and
-- re-run the file.)
-- Safe to run twice: every statement is ADD COLUMN IF NOT EXISTS /
-- CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS /
-- ON CONFLICT DO NOTHING, and the geometry is only written while the new
-- columns are still NULL. Nothing here drops or renames an existing column or
-- table, so the desktop console keeps working.
--
-- LAYOUT: 3 floors x (60 block_a + 9 side) = 207 slots on a 1920x1080 canvas.
-- This file backfills the geometry of every slot FROM THE DATA ITSELF -- the
-- bay counts are read out of slots.floor / zone / zone_row / zone_col, so there
-- is NO hard-coded 102, 34, 12 or 10 anywhere. block_a becomes a grid (however
-- many columns and rows the data uses) and side becomes a single column of bays
-- on the right.
--
-- The drawing is SCHEMATIC: bays sit on a clean grid computed from the slot
-- rows, not traced from an image (the repo only has the OLD 34-bay reference
-- drawings, which do not match this layout). shared/src/floorLayout.ts
-- reproduces the SAME arithmetic in TypeScript, and
-- database/live_upgrade/03_floor_plan_207.sql is the live-upgrade twin of this
-- file -- keep all three in step if you ever move the facility.
--
-- The reference drawings do not carry machine-readable entry/aisle data, so
-- the single entrance/aisle row in facility_layout is an ASSUMPTION: enter
-- bottom-right, up the trunk lane, then along the cross lane between block A's
-- rows. It lives in one editable row -- UPDATE facility_layout if the real
-- entrance is elsewhere; nothing else has to change.
--
-- NOTE ON RLS + THE NEW SLOT COLUMNS: Postgres RLS is row-level, not
-- column-level, so "only admins may modify the new slot columns" cannot be
-- expressed without also blocking the desktop's attendant Slot Assignment
-- screen, which legitimately updates slots. The existing slots policies are
-- therefore left untouched (read = everyone, write = staff) and the new
-- admin-only rule is applied to facility_layout only. See the report.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. Floor-plan geometry on slots ------------------------------------------
ALTER TABLE slots ADD COLUMN IF NOT EXISTS floor_x NUMERIC;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS floor_y NUMERIC;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS floor_w NUMERIC;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS floor_h NUMERIC;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS facing TEXT;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS entry_rank INTEGER;

DO $$ BEGIN
  ALTER TABLE slots ADD CONSTRAINT slots_facing_check
    CHECK (facing IN ('left', 'right', 'up', 'down'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Facility layout (single row) ------------------------------------------
CREATE TABLE IF NOT EXISTS facility_layout (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  canvas_width NUMERIC NOT NULL DEFAULT 1920,
  canvas_height NUMERIC NOT NULL DEFAULT 1080,
  entrance_x NUMERIC NOT NULL DEFAULT 1505,
  entrance_y NUMERIC NOT NULL DEFAULT 1005,
  -- aisle = the drivable path, used by computeRoute()/describeDirections()
  -- in shared/src/floorPlan.ts:
  --   trunk     : the vertical lane (x, from y0 to y1)
  --   crossLane : the horizontal lane between block A's two rows
  aisle JSONB NOT NULL DEFAULT '{"entrance":{"x":1505,"y":1005},"trunk":{"x":1505,"y0":560,"y1":1005},"crossLane":{"y":560,"x0":150,"x1":1505}}'::jsonb,
  labels JSONB NOT NULL DEFAULT '{"entrance":"Entrance / Exit","aisle":"Drive aisle","block_a":"Block A","side":"Side column"}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE facility_layout ENABLE ROW LEVEL SECURITY;

INSERT INTO facility_layout (id, canvas_width, canvas_height, entrance_x, entrance_y, aisle, labels)
VALUES (
  1, 1920, 1080, 1505, 1005,
  '{"entrance":{"x":1505,"y":1005},"trunk":{"x":1505,"y0":560,"y1":1005},"crossLane":{"y":560,"x0":150,"x1":1505}}'::jsonb,
  '{"entrance":"Entrance / Exit","aisle":"Drive aisle","block_a":"Block A","side":"Side column"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 3. Backfill geometry for every slot ---------------------------------------
-- Counts are derived from the data, so this works for 207 -- or any number.
-- Only writes rows whose floor_x is still NULL.
DO $$
DECLARE
  -- block_a rectangle and side-column rectangle on the 1920x1080 canvas.
  v_bx0 NUMERIC := 150;   v_bx1 NUMERIC := 1450;
  v_by0 NUMERIC := 220;   v_by1 NUMERIC := 900;
  v_sx0 NUMERIC := 1560;  v_sx1 NUMERIC := 1680;
  v_sy0 NUMERIC := 220;   v_sy1 NUMERIC := 980;
  v_aisle NUMERIC := 140; -- gap between block A's two rows

  f            RECORD;
  v_cols       INTEGER;
  v_nrows      INTEGER;
  v_nside      INTEGER;
  v_collist    INTEGER[];
  v_rowlabels  TEXT[];
  v_bayw       NUMERIC;
  v_rowh       NUMERIC;
  v_yy         NUMERIC;
  v_face       TEXT;
  i            INTEGER;
  j            INTEGER;
BEGIN
  FOR f IN SELECT DISTINCT floor FROM slots WHERE floor IS NOT NULL ORDER BY floor LOOP

    -- ---- block_a: a grid, rows x columns, both read from the data --------
    SELECT COUNT(DISTINCT zone_col)
      INTO v_cols
      FROM slots
     WHERE floor = f.floor AND zone = 'block_a' AND zone_col IS NOT NULL;

    IF v_cols > 0 THEN
      SELECT array_agg(DISTINCT zone_col ORDER BY zone_col)
        INTO v_collist
        FROM slots
       WHERE floor = f.floor AND zone = 'block_a' AND zone_col IS NOT NULL;

      -- Rows are ordered semantically: 'top' row first, then 'bottom'. (A plain
      -- ORDER BY would sort 'bottom' before 'top' and flip the two rows.)
      SELECT array_agg(rr ORDER BY CASE WHEN rr = 'top' THEN 0 ELSE 1 END, rr)
        INTO v_rowlabels
        FROM (
          SELECT DISTINCT COALESCE(zone_row, 'top') AS rr
            FROM slots
           WHERE floor = f.floor AND zone = 'block_a'
        ) t;
      v_nrows := COALESCE(array_length(v_rowlabels, 1), 1);

      v_bayw := (v_bx1 - v_bx0) / v_cols;
      IF v_nrows >= 2 THEN
        v_rowh := ((v_by1 - v_by0) - v_aisle) / v_nrows;
      ELSE
        v_rowh := 200;   -- single-row block A: a fixed, sensible depth
      END IF;

      FOR i IN 1..v_nrows LOOP
        IF v_nrows >= 2 THEN
          IF i = 1 THEN v_yy := v_by0; ELSE v_yy := v_by1 - v_rowh; END IF;
          v_face := CASE WHEN i = 1 THEN 'down' ELSE 'up' END;
        ELSE
          v_yy := v_by0;
          v_face := 'down';
        END IF;

        FOR j IN 1..v_cols LOOP
          UPDATE slots s
             SET floor_x = v_bx0 + (j - 1) * v_bayw,
                 floor_y = v_yy,
                 floor_w = v_bayw,
                 floor_h = v_rowh,
                 facing  = v_face
           WHERE s.floor = f.floor
             AND s.zone = 'block_a'
             AND s.zone_col = v_collist[j]
             AND COALESCE(s.zone_row, 'top') = v_rowlabels[i]
             AND s.floor_x IS NULL;
        END LOOP;
      END LOOP;
    END IF;

    -- ---- side: a single column of bays on the right, opening left -------
    SELECT COUNT(DISTINCT zone_col)
      INTO v_nside
      FROM slots
     WHERE floor = f.floor AND zone = 'side' AND zone_col IS NOT NULL;

    IF v_nside > 0 THEN
      SELECT array_agg(DISTINCT zone_col ORDER BY zone_col)
        INTO v_collist
        FROM slots
       WHERE floor = f.floor AND zone = 'side' AND zone_col IS NOT NULL;

      v_rowh := (v_sy1 - v_sy0) / v_nside;

      FOR j IN 1..v_nside LOOP
        UPDATE slots s
           SET floor_x = v_sx0,
               floor_y = v_sy0 + (j - 1) * v_rowh,
               floor_w = v_sx1 - v_sx0,
               floor_h = v_rowh,
               facing  = 'left'
         WHERE s.floor = f.floor
           AND s.zone = 'side'
           AND s.zone_col = v_collist[j]
           AND s.floor_x IS NULL;
      END LOOP;
    END IF;

  END LOOP;
END $$;

-- 4. entry_rank -- 1 = closest to the entrance (per floor). PWD bays are ranked
-- first, so the PWD bays are the ones nearest the entrance. Distance is
-- measured from the entrance to the bay's access point (the edge that opens
-- onto the aisle, given `facing`). Only fills rows whose entry_rank is NULL.
WITH entrance AS (
  SELECT entrance_x AS ex, entrance_y AS ey FROM facility_layout WHERE id = 1
),
access AS (
  SELECT
    s.id,
    s.floor,
    s.slot_code,
    s.is_pwd,
    CASE
      WHEN s.facing = 'down'  THEN s.floor_x + s.floor_w / 2
      WHEN s.facing = 'up'    THEN s.floor_x + s.floor_w / 2
      WHEN s.facing = 'left'  THEN s.floor_x
      ELSE s.floor_x + s.floor_w
    END AS ax,
    CASE
      WHEN s.facing = 'left'  THEN s.floor_y + s.floor_h / 2
      WHEN s.facing = 'right' THEN s.floor_y + s.floor_h / 2
      WHEN s.facing = 'up'    THEN s.floor_y
      ELSE s.floor_y + s.floor_h
    END AS ay
  FROM slots s
  WHERE s.floor_x IS NOT NULL
),
ranked AS (
  SELECT
    a.id,
    row_number() OVER (
      PARTITION BY a.floor
      ORDER BY
        CASE WHEN a.is_pwd THEN 0 ELSE 1 END,                     -- PWD bays first
        sqrt(power(a.ax - e.ex, 2) + power(a.ay - e.ey, 2)),      -- then nearest
        a.slot_code
    ) AS rn
  FROM access a CROSS JOIN entrance e
)
UPDATE slots s
SET entry_rank = r.entry_rank
FROM (SELECT id, rn AS entry_rank FROM ranked) r
WHERE s.id = r.id
  AND s.entry_rank IS NULL;

-- 5. RLS on facility_layout -------------------------------------------------
-- Any signed-in user may read the plan; only admins may change it.
DROP POLICY IF EXISTS "Authenticated can view facility layout" ON facility_layout;
CREATE POLICY "Authenticated can view facility layout" ON facility_layout
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert facility layout" ON facility_layout;
CREATE POLICY "Admins can insert facility layout" ON facility_layout
  FOR INSERT WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can update facility layout" ON facility_layout;
CREATE POLICY "Admins can update facility layout" ON facility_layout
  FOR UPDATE USING (is_admin());

DROP POLICY IF EXISTS "Admins can delete facility layout" ON facility_layout;
CREATE POLICY "Admins can delete facility layout" ON facility_layout
  FOR DELETE USING (is_admin());

-- 6. get_floor_plan(start, end) --------------------------------------------
-- Availability for the requested window, derived from the reservations
-- calendar (never from cameras). SECURITY DEFINER so it can see OTHER
-- customers' reservations in order to mark a slot 'reserved' -- it only ever
-- returns the availability string, never a plate or a name.
CREATE OR REPLACE FUNCTION get_floor_plan(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  slot_id UUID,
  slot_code TEXT,
  is_pwd BOOLEAN,
  floor SMALLINT,
  zone TEXT,
  zone_row TEXT,
  zone_col SMALLINT,
  floor_x NUMERIC,
  floor_y NUMERIC,
  floor_w NUMERIC,
  floor_h NUMERIC,
  facing TEXT,
  entry_rank INTEGER,
  availability TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pwd BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_pwd := is_pwd_verified(v_uid);
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.slot_code,
    s.is_pwd,
    s.floor,
    s.zone,
    s.zone_row,
    s.zone_col,
    s.floor_x,
    s.floor_y,
    s.floor_w,
    s.floor_h,
    s.facing,
    s.entry_rank,
    CASE
      WHEN s.status = 'maintenance' THEN 'maintenance'
      WHEN s.is_pwd AND NOT v_pwd THEN 'pwd_locked'
      WHEN EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.slot_id = s.id
          AND r.status NOT IN ('cancelled', 'completed', 'no_show')
          AND r.start_time < p_end
          AND r.end_time > p_start
          AND r.customer_id = v_uid
      ) THEN 'mine'
      WHEN EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.slot_id = s.id
          AND r.status NOT IN ('cancelled', 'completed', 'no_show')
          AND r.start_time < p_end
          AND r.end_time > p_start
      ) THEN 'reserved'
      ELSE 'available'
    END AS availability
  FROM slots s
  ORDER BY s.floor, s.slot_code;
END;
$$;

-- 7. assign_slot_for_reservation(vehicle, start, end) ----------------------
-- SECURITY DEFINER: the caller never passes a customer id, only their own
-- vehicle. Picks the best free slot atomically (row locks + SKIP LOCKED, and
-- a retry when the exclusion constraint fires) and inserts the reservation
-- through the normal path so the existing triggers/constraints still run.
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
  MAX_DURATION_HOURS CONSTANT NUMERIC := 24;
  PAST_TOLERANCE_MINUTES CONSTANT INTEGER := 5;
  MAX_ATTEMPTS CONSTANT INTEGER := 3;

  v_uid UUID := auth.uid();
  v_owner UUID;
  v_pwd BOOLEAN;
  v_attempt INTEGER := 0;
  v_slot RECORD;
  v_res reservations;
  v_rate NUMERIC;
  v_hours NUMERIC;
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

-- 8. change_reservation_slot(reservation, new slot) ------------------------
CREATE OR REPLACE FUNCTION change_reservation_slot(
  p_reservation_id UUID,
  p_new_slot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res reservations;
  v_slot RECORD;
  v_pwd BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF v_res.id IS NULL OR v_res.customer_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  -- Only before the vehicle has been verified/occupied.
  IF v_res.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT id, slot_code, is_pwd, floor, status INTO v_slot
  FROM slots WHERE id = p_new_slot_id;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF v_slot.status = 'maintenance' THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  v_pwd := is_pwd_verified(v_uid);
  IF v_slot.is_pwd AND NOT v_pwd THEN
    RAISE EXCEPTION 'PWD_ONLY';
  END IF;

  -- Free for the same window, ignoring this reservation itself.
  IF EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.slot_id = p_new_slot_id
      AND r.id <> p_reservation_id
      AND r.status NOT IN ('cancelled', 'completed', 'no_show')
      AND r.start_time < v_res.end_time
      AND r.end_time > v_res.start_time
  ) THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  BEGIN
    UPDATE reservations SET slot_id = p_new_slot_id WHERE id = p_reservation_id
    RETURNING * INTO v_res;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END;

  PERFORM create_notification(
    v_uid,
    'Slot changed',
    'Your booking ' || v_res.booking_code || ' is now on slot ' || v_slot.slot_code || '.',
    'reservation',
    v_res.id
  );

  PERFORM log_audit(
    v_uid,
    'slot_changed',
    jsonb_build_object(
      'reservation_id', v_res.id,
      'booking_code', v_res.booking_code,
      'slot_id', v_slot.id,
      'slot_code', v_slot.slot_code
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res.id,
    'booking_code', v_res.booking_code,
    'slot_id', v_slot.id,
    'slot_code', v_slot.slot_code,
    'floor', v_slot.floor,
    'start_time', v_res.start_time,
    'end_time', v_res.end_time
  );
END;
$$;

-- 9. Grants: authenticated only --------------------------------------------
REVOKE ALL ON FUNCTION get_floor_plan(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION assign_slot_for_reservation(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION change_reservation_slot(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION get_floor_plan(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_slot_for_reservation(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION change_reservation_slot(UUID, UUID) TO authenticated;

COMMIT;

-- ===========================================================================
-- VERIFICATION -- copy/paste these one at a time AFTER running the file.
-- ===========================================================================
--
-- V1. New columns exist:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'slots' AND column_name IN
--        ('floor_x','floor_y','floor_w','floor_h','facing','entry_rank');
--   expect 6 rows.
--
-- V2. Every slot got geometry + a rank (expect 207 / 207 / 207):
-- SELECT COUNT(*) FILTER (WHERE floor_x IS NOT NULL) AS with_geometry,
--        COUNT(*) FILTER (WHERE entry_rank IS NOT NULL) AS with_rank,
--        COUNT(*) AS total FROM slots;
--
-- V3. 69 bays per floor (60 block_a + 9 side):
-- SELECT floor, COUNT(*) FROM slots GROUP BY floor ORDER BY floor;
--   expect 69, 69, 69.
--
-- V4. PWD bays: block_a columns 8-12 of every 12-col row, plus side 1-5.
--     expect 30 per floor (25 block_a + 5 side), 90 total:
-- SELECT floor, COUNT(*) FROM slots WHERE is_pwd GROUP BY floor ORDER BY floor;
-- SELECT zone, COUNT(*) FROM slots WHERE is_pwd GROUP BY zone;
--
-- V5. The single layout row:
-- SELECT canvas_width, canvas_height, entrance_x, entrance_y, aisle FROM facility_layout;
--
-- V6. The three functions exist:
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_floor_plan','assign_slot_for_reservation','change_reservation_slot');
--
-- V7. See the plan the phone will draw (run as a signed-in user in the app,
--     not in the SQL editor, so auth.uid() is set):
-- SELECT slot_code, floor, floor_x, floor_y, floor_w, floor_h, facing, entry_rank, availability
--   FROM get_floor_plan(NOW(), NOW() + INTERVAL '2 hours')
--  ORDER BY entry_rank LIMIT 20;
--
-- ===========================================================================
-- MANUAL TEST CHECKLIST
-- ===========================================================================
-- [ ] V1-V6 above all return what they say they should.
-- [ ] Register a normal customer in the app, book -> a slot is assigned
--     automatically and the phone draws the floor plan with a route.
-- [ ] Book a second, overlapping window -> a DIFFERENT slot is assigned.
-- [ ] A PWD-locked slot shows 'pwd_locked' for a non-verified customer and
--     is not chosen for them.
-- [ ] A customer with an unpaid penalty is refused with UNPAID_PENALTIES.
-- [ ] "Change slot" moves the booking; a taken slot answers SLOT_TAKEN.
-- [ ] Desktop Live Occupancy shows the new reservation on the same slot
--     (proves the phone and desktop share one layout).
