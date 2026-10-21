-- ===========================================================================
-- ParkWise - LIVE upgrade - 07_vehicles_is_active.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   The mobile app's vehicle screens (Reserve's "Add vehicle", My Vehicles)
--   all read/write public.vehicles.is_active - a used vehicle is archived
--   (is_active = false) instead of hard-deleted, so its reservations (and the
--   payments/penalties that cascade off them) are never destroyed. This
--   column was added to the repo's fresh-install baseline script a while ago,
--   but was missed when the live_upgrade path was built - so the live
--   database never got it, and every vehicles query fails with
--   "column vehicle.is_active does not exist".
--
--   This file adds:
--     1. public.vehicles.is_active (BOOLEAN, default TRUE) - every existing
--        vehicle row is backfilled to TRUE (still active), matching how the
--        fresh-install script behaves.
--     2. reservations.vehicle_id's foreign key, changed from ON DELETE CASCADE
--        to ON DELETE RESTRICT - the same safety net the fresh-install script
--        has: even if something bypassed the app's own checks, the database
--        itself refuses to let a vehicle with booking history be hard-deleted.
--        (The app only ever hard-deletes a vehicle with zero reservations, so
--        this should never actually block anything in normal use.)
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema - profiles/vehicles/reservations tables
--   from 02_profile_vehicle_rates_upgrade.sql are enough.
--
-- HOW TO VERIFY (read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='vehicles' AND column_name='is_active';
--   -- expect 1 row
--
--   SELECT confdeltype FROM pg_constraint
--    WHERE conname = 'reservations_vehicle_id_fkey';
--   -- expect 'r' (RESTRICT), not 'c' (CASCADE)
--
-- SAFE TO RUN TWICE: the column add is IF NOT EXISTS, and the constraint is
-- dropped and recreated identically each time.
-- ===========================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_vehicle_id_fkey;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;
