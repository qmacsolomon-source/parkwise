-- Legacy: built for the older 102-slot layout. The live database is the source of truth; see database/live_upgrade/RUN_ORDER_LIVE.md.
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
-- ON CONFLICT DO NOTHING, and the geometry UPDATEs always write the same
-- values. Nothing here drops or renames an existing column or table, so the
-- desktop console keeps working.
--
-- LAYOUT SOURCE OF TRUTH: the desktop console's own floor plan --
-- desktop/src/components/ParkingFloorMap.tsx -- draws each floor on top of
-- the 1920x1080 reference drawings desktop/src/assets/floor-maps/floor-{n}.png
-- and places slot markers at pixel coordinates measured off those images.
-- The seed below reuses EXACTLY those numbers, so the phone shows the same
-- floor plan as the desktop:
--   * block_a  top row    : 12 slots, y 375..565, centres at bayCentersX
--   * block_a  bottom row : 12 slots, y 693..883, same centres
--   * side column         : 10 slots, x 1536..1660, centres at sideCentersY
--   * PWD = block_a top-row columns 11 and 12 (nearest the core)
-- That is 34 slots per floor, 102 total -- the same 102 the desktop renders.
--
-- The reference drawings do not carry machine-readable entry/aisle data, so
-- the single entrance/aisle row in facility_layout is an ASSUMPTION read off
-- the drawing's geometry (a drive lane in the gap between block A's right
-- edge and the side column, entry at the bottom). It lives in one editable
-- row -- UPDATE facility_layout if the real entrance is elsewhere; nothing
-- else has to change.
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
  entrance_x NUMERIC NOT NULL DEFAULT 1420,
  entrance_y NUMERIC NOT NULL DEFAULT 1005,
  -- aisle = the drivable path, used by computeRoute()/describeDirections()
  -- in shared/src/floorPlan.ts:
  --   trunk     : the vertical lane (x, from y0 to y1)
  --   crossLane : the horizontal lane that fans out to block A's two rows
  aisle JSONB NOT NULL DEFAULT '{"entrance":{"x":1420,"y":1005},"trunk":{"x":1420,"y0":240,"y1":1005},"crossLane":{"y":629,"x0":430,"x1":1420}}'::jsonb,
  labels JSONB NOT NULL DEFAULT '{"entrance":"Entrance / Exit","aisle":"Drive aisle","block_a":"Block A","side":"Side column"}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE facility_layout ENABLE ROW LEVEL SECURITY;

INSERT INTO facility_layout (id, canvas_width, canvas_height, entrance_x, entrance_y, aisle, labels)
VALUES (
  1, 1920, 1080, 1420, 1005,
  '{"entrance":{"x":1420,"y":1005},"trunk":{"x":1420,"y0":240,"y1":1005},"crossLane":{"y":629,"x0":430,"x1":1420}}'::jsonb,
  '{"entrance":"Entrance / Exit","aisle":"Drive aisle","block_a":"Block A","side":"Side column"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 3. Seed the geometry -- desktop ParkingFloorMap.tsx FLOOR_LAYOUTS -------
WITH layout(floor, bays, top_top, top_bot, bot_top, bot_bot, side_x0, side_x1, side_cys) AS (
  VALUES
    (1,
     ARRAY[475, 547, 623, 698, 774, 849, 925, 1001, 1076, 1152, 1227, 1301]::numeric[],
     375::numeric, 565::numeric, 693::numeric, 883::numeric,
     1536::numeric, 1660::numeric,
     ARRAY[273, 348, 424, 499, 575, 651, 726, 802, 877, 953]::numeric[]),
    (2,
     ARRAY[482, 553, 628, 702, 777, 851, 925, 1000, 1074, 1148, 1223, 1295]::numeric[],
     378::numeric, 565::numeric, 690::numeric, 877::numeric,
     1527::numeric, 1654::numeric,
     ARRAY[277, 351, 426, 500, 574, 649, 723, 798, 872, 946]::numeric[]),
    (3,
     ARRAY[487, 557, 631, 704, 778, 851, 925, 999, 1072, 1146, 1219, 1291]::numeric[],
     380::numeric, 565::numeric, 689::numeric, 874::numeric,
     1521::numeric, 1649::numeric,
     ARRAY[280, 354, 427, 501, 575, 648, 722, 796, 869, 943]::numeric[])
),
geo AS (
  -- block_a: 12 top-row + 12 bottom-row bays, 60 px wide, facing the centre aisle
  SELECT
    l.floor,
    'block_a'::text AS zone,
    r.zone_row,
    r.zone_col,
    (l.bays[r.zone_col] - 30) AS x,
    CASE WHEN r.zone_row = 'top' THEN l.top_top ELSE l.bot_top END AS y,
    60 AS w,
    CASE WHEN r.zone_row = 'top' THEN l.top_bot - l.top_top ELSE l.bot_bot - l.bot_top END AS h,
    CASE WHEN r.zone_row = 'top' THEN 'down' ELSE 'up' END AS facing
  FROM layout l
  CROSS JOIN (
    SELECT r AS zone_row, c AS zone_col
    FROM (VALUES ('top'), ('bottom')) AS rr(r),
         generate_series(1, 12) AS c
  ) r
  UNION ALL
  -- side column: 10 bays, 50 px tall, facing the lane on their left
  SELECT
    l.floor,
    'side'::text,
    NULL::text,
    n,
    l.side_x0,
    (l.side_cys[n] - 25),
    (l.side_x1 - l.side_x0),
    50,
    'left'
  FROM layout l
  CROSS JOIN generate_series(1, 10) AS n
)
UPDATE slots s
SET floor_x = g.x,
    floor_y = g.y,
    floor_w = g.w,
    floor_h = g.h,
    facing  = g.facing
FROM geo g
WHERE s.floor = g.floor
  AND s.zone = g.zone
  AND s.zone_col = g.zone_col
  AND (s.zone_row IS NOT DISTINCT FROM g.zone_row);

-- 4. entry_rank -- 1 = closest to the entrance (per floor), by straight-line
-- distance from the entrance to each slot's access point (the edge that
-- opens onto the aisle, given `facing`).
WITH entrance AS (
  SELECT entrance_x AS ex, entrance_y AS ey FROM facility_layout WHERE id = 1
),
access AS (
  SELECT
    s.id,
    s.floor,
    s.slot_code,
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
      ORDER BY sqrt(power(a.ax - e.ex, 2) + power(a.ay - e.ey, 2)), a.slot_code
    ) AS rn
  FROM access a CROSS JOIN entrance e
)
UPDATE slots s
SET entry_rank = r.entry_rank
FROM (SELECT id, rn AS entry_rank FROM ranked) r
WHERE s.id = r.id;

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
-- V2. Every slot got geometry + a rank (expect 102 / 102):
-- SELECT COUNT(*) FILTER (WHERE floor_x IS NOT NULL) AS with_geometry,
--        COUNT(*) FILTER (WHERE entry_rank IS NOT NULL) AS with_rank,
--        COUNT(*) AS total FROM slots;
--
-- V3. Layout still matches the desktop (34 per floor):
-- SELECT floor, COUNT(*) FROM slots GROUP BY floor ORDER BY floor;
--   expect 34, 34, 34.
--
-- V4. PWD bays are block_a top-row columns 11 and 12, one pair per floor:
-- SELECT floor, slot_code FROM slots WHERE is_pwd ORDER BY floor, slot_code;
--   expect 1A11,1A12,2A11,2A12,3A11,3A12.
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
