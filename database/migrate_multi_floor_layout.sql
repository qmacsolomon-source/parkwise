-- Legacy: built for the older 102-slot layout. The live database is the source of truth; see database/live_upgrade/RUN_ORDER_LIVE.md.
-- UPGRADE ONLY. Do NOT run on a fresh project. This file can delete or
-- rename slots; run it only on an old database after a backup, and only
-- if there are no reservations or payments you need.
--
-- One-time migration: expands the existing single-floor, 20-slot layout
-- (A1-A20) into the new 3-floor, 56-slots-per-floor parking map used by
-- LiveOccupancyDashboard/SlotAssignment.
--
-- Run this AFTER schema.sql (which adds the floor/zone/zone_row/zone_col
-- columns). This file is NOT part of schema.sql/seed.sql because it does
-- something those don't: it UPDATEs existing rows by their OLD slot_code
-- rather than just inserting new ones, specifically so every reservation
-- and payment already tied to A1-A20 stays intact (those rows reference
-- slots.id, not slot_code, so renaming/relocating them in place preserves
-- all existing history). A fresh install never needs this file -- it goes
-- straight from schema.sql to seed.sql, which already seeds the full
-- 3-floor layout directly.
--
-- Safe to re-run: every UPDATE only matches its specific old slot_code
-- (so it's a no-op once that slot has already been renamed), and every
-- INSERT is guarded with ON CONFLICT (slot_code) DO NOTHING.

-- Step 1: remap the 20 existing slots into floor 1's "compact" row
-- (A1/A2, already PWD) and the top/partial-bottom of "block_a".
UPDATE slots SET slot_code = '1C1', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 1 WHERE slot_code = 'A1';
UPDATE slots SET slot_code = '1C2', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 2 WHERE slot_code = 'A2';
UPDATE slots SET slot_code = '1C3', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 3 WHERE slot_code = 'A3';
UPDATE slots SET slot_code = '1C4', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 4 WHERE slot_code = 'A4';
UPDATE slots SET slot_code = '1C5', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 5 WHERE slot_code = 'A5';
UPDATE slots SET slot_code = '1C6', floor = 1, zone = 'compact', zone_row = NULL, zone_col = 6 WHERE slot_code = 'A6';
UPDATE slots SET slot_code = '1A1', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 1 WHERE slot_code = 'A7';
UPDATE slots SET slot_code = '1A2', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 2 WHERE slot_code = 'A8';
UPDATE slots SET slot_code = '1A3', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 3 WHERE slot_code = 'A9';
UPDATE slots SET slot_code = '1A4', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 4 WHERE slot_code = 'A10';
UPDATE slots SET slot_code = '1A5', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 5 WHERE slot_code = 'A11';
UPDATE slots SET slot_code = '1A6', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 6 WHERE slot_code = 'A12';
UPDATE slots SET slot_code = '1A7', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 7 WHERE slot_code = 'A13';
UPDATE slots SET slot_code = '1A8', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 8 WHERE slot_code = 'A14';
UPDATE slots SET slot_code = '1A9', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 9 WHERE slot_code = 'A15';
UPDATE slots SET slot_code = '1A10', floor = 1, zone = 'block_a', zone_row = 'top', zone_col = 10 WHERE slot_code = 'A16';
UPDATE slots SET slot_code = '1A11', floor = 1, zone = 'block_a', zone_row = 'bottom', zone_col = 1 WHERE slot_code = 'A17';
UPDATE slots SET slot_code = '1A12', floor = 1, zone = 'block_a', zone_row = 'bottom', zone_col = 2 WHERE slot_code = 'A18';
UPDATE slots SET slot_code = '1A13', floor = 1, zone = 'block_a', zone_row = 'bottom', zone_col = 3 WHERE slot_code = 'A19';
UPDATE slots SET slot_code = '1A14', floor = 1, zone = 'block_a', zone_row = 'bottom', zone_col = 4 WHERE slot_code = 'A20';

-- Step 2: finish floor 1 -- the rest of block_a's bottom row, all of
-- block_b, and the side column.
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT '1A' || (10 + c)::text, FALSE, 'available', 1, 'block_a', 'bottom', c
FROM generate_series(5, 10) AS c
ON CONFLICT (slot_code) DO NOTHING;

INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT '1B' || ((r - 1) * 10 + c)::text, FALSE, 'available', 1, 'block_b',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(1, 2) AS r, generate_series(1, 10) AS c
ON CONFLICT (slot_code) DO NOTHING;

INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT '1S' || n::text, FALSE, 'available', 1, 'side', NULL, n
FROM generate_series(1, 10) AS n
ON CONFLICT (slot_code) DO NOTHING;

-- Step 3: floors 2 and 3, built fresh (same 56-slot layout as floor 1).
INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'C' || n::text, (n IN (1, 2)), 'available', f, 'compact', NULL, n
FROM generate_series(2, 3) AS f, generate_series(1, 6) AS n
ON CONFLICT (slot_code) DO NOTHING;

INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'A' || ((r - 1) * 10 + c)::text, FALSE, 'available', f, 'block_a',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(2, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 10) AS c
ON CONFLICT (slot_code) DO NOTHING;

INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'B' || ((r - 1) * 10 + c)::text, FALSE, 'available', f, 'block_b',
       CASE WHEN r = 1 THEN 'top' ELSE 'bottom' END, c
FROM generate_series(2, 3) AS f, generate_series(1, 2) AS r, generate_series(1, 10) AS c
ON CONFLICT (slot_code) DO NOTHING;

INSERT INTO slots (slot_code, is_pwd, status, floor, zone, zone_row, zone_col)
SELECT f::text || 'S' || n::text, FALSE, 'available', f, 'side', NULL, n
FROM generate_series(2, 3) AS f, generate_series(1, 10) AS n
ON CONFLICT (slot_code) DO NOTHING;

-- Step 4: give every newly-created slot an idle agent_state (same
-- pattern as seed.sql; existing rows are untouched via ON CONFLICT).
INSERT INTO agent_states (slot_id, state)
SELECT id, 'idle' FROM slots
ON CONFLICT (slot_id) DO NOTHING;

-- Verify: should return 168 once this has fully run.
-- SELECT count(*) FROM slots;
