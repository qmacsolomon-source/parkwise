-- Legacy, UPGRADE ONLY, and DESTRUCTIVE: reshapes floors to the older 102-slot
-- reference layout. Do NOT run it on a fresh project and never twice (it
-- deletes or renames slots, cascading into reservations/payments); run it only
-- on an old database, after a backup, and only if there are no reservations or
-- payments you need. See database/RUN_ORDER.md.
--
-- One-time migration: shrink each floor's layout from 56 slots to the
-- 34 slots that actually appear in the final reference images
-- (desktop/src/assets/floor-maps/floor-{n}.png): one block of 12 top +
-- 12 bottom stalls, plus the existing 10-stall side column. Drops the
-- "compact" zone (6/floor) and "block_b" zone (20/floor) entirely, and
-- extends "block_a" from 10+10 to 12+12.
--
-- This is a clean delete + recreate, NOT a history-preserving remap like
-- migrate_multi_floor_layout.sql was. That's safe here only because the
-- live project currently has ZERO reservations and ZERO payments
-- referencing any slot (confirmed via a live query before writing this
-- file). If that's no longer true by the time you run this, STOP and
-- check first -- deleting a slot with reservation/payment history
-- attached cascade-deletes that history too.
--
-- The side column is untouched by this migration (still 10/floor, same
-- codes, same rows) since its real count already matched the image.

BEGIN;

DELETE FROM slots WHERE zone IN ('compact', 'block_b');
DELETE FROM slots WHERE zone = 'block_a';

-- Block A: {floor}A1..{floor}A24 (top row 1-12, bottom row 13-24).
-- Top-row columns 11/12 (nearest the elevator/stairs core in the image)
-- are PWD.
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || ((r - 1) * 12 + c)::text, (r = 1 AND c IN (11, 12)), 'available', f, 'block_a',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(1, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 12) AS c;

-- Backfill agent_states for the newly (re)created block_a slots -- the
-- old rows were cascade-deleted along with their slots above.
INSERT INTO agent_states (slot_id, state)
SELECT id, 'idle' FROM slots
ON CONFLICT (slot_id) DO NOTHING;

COMMIT;

-- Verify: should show 34 for every floor.
SELECT floor, COUNT(*) AS slot_count FROM slots GROUP BY floor ORDER BY floor;
