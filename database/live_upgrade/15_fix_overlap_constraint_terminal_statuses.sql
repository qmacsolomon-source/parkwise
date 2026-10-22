-- ===========================================================================
-- 15_fix_overlap_constraint_terminal_statuses.sql
-- The live `no_overlapping_reservations` EXCLUDE constraint has no WHERE
-- clause, so it blocks a slot+time-range combination FOREVER once any
-- reservation has ever existed there - even a cancelled/completed/no_show
-- one. schema.sql (the fresh-install reference) already has the correct,
-- WHERE-qualified version; this live database was evidently set up before
-- that WHERE clause was added, and no migration ever brought it forward.
--
-- CONFIRMED LIVE: reassigning a reservation onto a slot that had an earlier
-- *completed* reservation for an overlapping window failed with
-- "conflicting key value violates exclusion constraint
-- no_overlapping_reservations" - against the completed row, which should
-- never have been in the index at all.
--
-- Postgres has no "ALTER CONSTRAINT ... ADD WHERE" - an EXCLUDE constraint's
-- predicate can only be changed by dropping and recreating it.
--
-- Safe to re-run: DROP ... IF EXISTS before CREATE.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS no_overlapping_reservations;

ALTER TABLE reservations ADD CONSTRAINT no_overlapping_reservations EXCLUDE USING GIST (
  slot_id WITH =,
  tstzrange(start_time, end_time) WITH &&
) WHERE (status NOT IN ('cancelled', 'completed', 'no_show'));

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'no_overlapping_reservations';
-- Expected: ends with "WHERE ((status <> ALL (ARRAY['cancelled'::reservation_status, 'completed'::reservation_status, 'no_show'::reservation_status])))"
