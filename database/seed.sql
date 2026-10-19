-- Legacy: built for the older 102-slot layout. The live database is the source of truth; see database/live_upgrade/RUN_ORDER_LIVE.md.
-- ParkWise Database Seeding Script
-- Run after schema.sql, business_rules.sql, rls_policies.sql and
-- profile_vehicle_rates_fixes.sql. No demo users are created here. Create the
-- first admin in Supabase Authentication > Users, then promote it with the
-- promote-to-admin query in database/RUN_ORDER.md (step 5).

-- 3-floor parking map, 34 slots per floor (102 total), matching the
-- actual reference images (desktop/src/assets/floor-maps/floor-{n}.png)
-- pixel-for-pixel: one double-loaded aisle block ("block_a", 24 slots --
-- a top row and a bottom row of 12), and a single-file "side" column
-- along the far wall (10 slots). Top-row columns 11/12 (nearest the
-- elevator/stairs core drawn in the image) are PWD.
-- zone/zone_row/zone_col feed the visual layout only -- see schema.sql.
-- "compact" and "block_b" are no longer used (the schema's zone CHECK
-- still allows them for upgrade compatibility, but nothing seeds them).

-- Block A: {floor}A1..{floor}A24 (top row 1-12, bottom row 13-24)
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || ((r - 1) * 12 + c)::text, (r = 1 AND c IN (11, 12)), 'available', f, 'block_a',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(1, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 12) AS c
ON CONFLICT (slot_code) DO NOTHING;

-- Side column: {floor}S1..{floor}S10
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'S' || n::text, FALSE, 'available', f, 'side', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 10) AS n
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