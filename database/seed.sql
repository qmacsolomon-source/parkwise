-- ParkWise Database Seeding Script
-- Run after schema.sql, business_rules.sql, and rls_policies.sql.
-- No demo users are created here. Create the first admin in
-- Supabase Authentication > Users, then promote it (see the end of this file).

-- 20 slots (A1-A20), A1 and A2 are PWD slots
INSERT INTO slots (slot_code, is_pwd, status)
SELECT 'A' || n, (n IN (1, 2)), 'available'
FROM generate_series(1, 20) AS n
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