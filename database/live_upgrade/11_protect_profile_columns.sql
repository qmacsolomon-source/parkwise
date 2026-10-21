-- ===========================================================================
-- ParkWise - LIVE upgrade - 11_protect_profile_columns.sql  *** SECURITY FIX ***
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   The live database's own RLS policy is:
--     CREATE POLICY "Users can update own profile" ON profiles
--       FOR UPDATE USING (auth.uid() = id);
--   That only checks WHICH ROW a customer can update (their own) - it has no
--   WITH CHECK clause restricting WHICH COLUMNS they can change, and
--   Postgres RLS cannot restrict an UPDATE to specific columns on its own.
--   Right now, on the live project, any signed-in customer can run:
--     supabase.from('profiles').update({ role: 'admin' }).eq('id', <own id>)
--   and it succeeds - granting themselves staff access, re-enabling their own
--   disabled account, or marking their own PWD permit verified without staff
--   ever reviewing it.
--
--   This exact protection has existed in the repo's fresh-install baseline
--   script for a while (protect_profile_columns(), a BEFORE UPDATE trigger
--   that pins role/status/pwd_verified back to their old value for anyone
--   who isn't already staff) - but it was never carried into the
--   live_upgrade path, so the live database has never actually had it.
--   This is the same kind of gap as 07 (vehicles.is_active) and
--   10 (request_my_account_deletion), except this one is a real security
--   hole rather than a broken feature - fix this one first, before anything
--   else in this folder.
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema - profiles already exists with role,
--   status and pwd_verified columns.
--
-- HOW TO VERIFY (read-only)
--   SELECT tgname FROM pg_trigger WHERE tgname = 'protect_profile_columns_trg';
--   -- expect 1 row
--
--   Optional (as a signed-in customer, NOT the SQL editor/service role -
--   the SQL editor runs with no auth.uid() and is intentionally exempt):
--   try updating your own role from the app and confirm it no longer takes
--   effect (the row still reads back with its old role).
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end user on the request: a migration or an operator, not the app.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role IN ('attendant', 'admin')
  ) THEN
    RETURN NEW;
  END IF;

  NEW.role := OLD.role;
  NEW.status := OLD.status;
  NEW.pwd_verified := OLD.pwd_verified;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_columns_trg ON public.profiles;
CREATE TRIGGER protect_profile_columns_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();
