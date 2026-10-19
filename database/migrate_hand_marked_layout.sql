-- One-time migration: replace the 34-slot-per-floor layout with the real
-- 69-slot-per-floor layout hand-marked directly over the floor-1 reference
-- image (one box per actual stall, placed with the coordinate-picker
-- tool - desktop/src/components/ParkingFloorMap.tsx has the exact
-- coordinates). "block_a" grows from 24/floor to 60/floor (5 rows of 12,
-- not 2), and "side" grows from 10/floor to 9/floor. Floors 2 and 3 reuse
-- the same box layout as floor 1 (same physical garage).
--
-- This is a clean delete + recreate, not a history-preserving remap.
-- That's safe here only because the live project currently has ZERO
-- reservations and ZERO payments referencing any slot (confirmed via a
-- live query before writing this file). If that's no longer true by the
-- time you run this, STOP and check first -- deleting a slot with
-- reservation/payment history attached cascade-deletes that history too.

BEGIN;

DELETE FROM slots WHERE zone IN ('compact', 'block_a', 'block_b', 'side');

-- Block A: {floor}A1..{floor}A60. Columns 8-12 of each row of 12 are PWD
-- (zone_col 8-12, 20-24, 32-36, 44-48, 56-60).
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || n::text, (((n - 1) % 12) + 1) IN (8, 9, 10, 11, 12), 'available', f, 'block_a', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 60) AS n;

-- Side column: {floor}S1..{floor}S9, columns 1-5 (nearest the elevator) are PWD.
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'S' || n::text, n IN (1, 2, 3, 4, 5), 'available', f, 'side', NULL, n
FROM generate_series(1, 3) AS f, generate_series(1, 9) AS n;

-- Backfill agent_states for the newly (re)created slots -- the old rows
-- were cascade-deleted along with their slots above.
INSERT INTO agent_states (slot_id, state)
SELECT id, 'idle' FROM slots
ON CONFLICT (slot_id) DO NOTHING;

COMMIT;

-- Verify: should show 69 for every floor, 207 total.
SELECT floor, COUNT(*) AS slot_count FROM slots GROUP BY floor ORDER BY floor;
