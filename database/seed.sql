-- ParkWise Database Seeding Script
-- Run after schema.sql, business_rules.sql, and rls_policies.sql.
-- No demo users are created here. Create the first admin in
-- Supabase Authentication > Users, then promote it (see the end of this file).

-- 3-floor parking map, 56 slots per floor (168 total), matching the
-- layout LiveOccupancyDashboard/SlotAssignment render: a small "compact"
-- row near the entrance (6 slots, 2 of them PWD), two big double-loaded
-- aisle blocks ("block_a"/"block_b", 20 slots each: a top row and a
-- bottom row of 10, with a divider the frontend draws after column 5),
-- and a single-file "side" column along the far wall (10 slots).
-- zone/zone_row/zone_col feed the visual layout only -- see schema.sql.

-- Compact row: {floor}C1..{floor}C6, C1/C2 are PWD
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'C' || n::text, (n IN (1, 2)), 'available', f, 'compact', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 6) AS n
ON CONFLICT (slot_code) DO NOTHING;

-- Block A: {floor}A1..{floor}A20 (top row 1-10, bottom row 11-20)
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || ((r - 1) * 10 + c)::text, FALSE, 'available', f, 'block_a',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(1, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 10) AS c
ON CONFLICT (slot_code) DO NOTHING;

-- Block B: {floor}B1..{floor}B20 (top row 1-10, bottom row 11-20)
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'B' || ((r - 1) * 10 + c)::text, FALSE, 'available', f, 'block_b',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(1, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 10) AS c
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