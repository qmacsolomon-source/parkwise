-- Legacy: built for the older 102-slot layout. The live database is the source of truth; see database/live_upgrade/RUN_ORDER_LIVE.md.
-- ParkWise Database Seeding Script
-- Run after schema.sql, business_rules.sql, rls_policies.sql and
-- profile_vehicle_rates_fixes.sql. No demo users are created here. Create the
-- first admin in Supabase Authentication > Users, then promote it with the
-- promote-to-admin query in database/RUN_ORDER.md (step 5).

-- 3-floor parking map, 69 slots per floor (207 total), matching the
-- click-zone boxes hand-marked directly over the real floor-1 reference
-- image (desktop/src/assets/floor-maps/floor-{n}.png) -- one box per real
-- stall, placed with the coordinate-picker tool rather than estimated.
-- Floors 2 and 3 reuse the exact same box layout (same real-world garage,
-- hand-marking each floor separately isn't worth repeating).
-- "block_a" (60 slots: 5 rows of 12) is the main block; "side" (9 slots)
-- is the single-file column along the far wall. zone_col is a flat
-- reading-order index (1-60 / 1-9) that the frontend zips directly against
-- its own fixed box-coordinate list -- see ParkingFloorMap.tsx.
-- zone_row is unused (NULL) under this layout. "compact" and "block_b"
-- are no longer used (the schema's zone CHECK still allows them for
-- upgrade compatibility, but nothing seeds them).

-- Block A: {floor}A1..{floor}A60. Columns 8-12 of each row of 12 are PWD
-- (i.e. zone_col 8-12, 20-24, 32-36, 44-48, 56-60).
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || n::text, (((n - 1) % 12) + 1) IN (8, 9, 10, 11, 12), 'available', f, 'block_a', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 60) AS n
ON CONFLICT (slot_code) DO NOTHING;

-- Side column: {floor}S1..{floor}S9, columns 1-5 (nearest the elevator) are PWD.
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'S' || n::text, n IN (1, 2, 3, 4, 5), 'available', f, 'side', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 9) AS n
ON CONFLICT (slot_code) DO NOTHING;

-- Default rates (only if the table is empty)
INSERT INTO rates (hourly_rate, overstay_per_hour, no_show_penalty, late_cancel_penalty, late_cancel_window_minutes, grace_period_minutes, updated_by)
SELECT 50, 100, 100, 50, 30, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM rates);

-- One idle agent state per slot
INSERT INTO agent_states (slot_id, state)
SELECT id, 'idle' FROM slots
ON CONFLICT (slot_id) DO NOTHING;

-- Enable Realtime on required tables (safe to re-run)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slots', 'reservations', 'agent_states', 'notifications']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;

-- Verify data
SELECT 'Slots created:' AS info, COUNT(*) AS count FROM slots;
SELECT 'Rates created:' AS info, COUNT(*) AS count FROM rates;
SELECT 'Agent states created:' AS info, COUNT(*) AS count FROM agent_states;