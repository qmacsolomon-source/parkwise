-- ===========================================================================
-- ParkWise - LIVE upgrade - 06_profiles_realtime.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Adds public.profiles to the supabase_realtime publication. Without this,
--   a change made on the desktop console (PWD verification, status changes,
--   etc.) never reaches an already-open mobile session - the customer's app
--   only picks it up if something else happens to trigger a refetch (a
--   screen regaining focus, logging back in). With this, the mobile app's
--   realtime subscription on the signed-in user's own profile row (added in
--   AuthContext) receives the change immediately, regardless of what screen
--   is open.
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema. Existing RLS ("Users can view own
--   profile") already restricts a subscriber to their own row; this file
--   does not touch RLS.
--
-- HOW TO VERIFY (read-only)
--   SELECT COUNT(*) FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles';
--   -- expect 1
--
-- SAFE TO RUN TWICE: guarded by duplicate_object, same pattern seed.sql uses
-- for the other realtime tables.
-- ===========================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
