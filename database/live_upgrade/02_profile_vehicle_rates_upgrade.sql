-- ===========================================================================
-- ParkWise - LIVE upgrade - 02_profile_vehicle_rates_upgrade.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   The mobile app assumes some helpers/policies that the live database does
--   not have yet. This file adds them. It is adapted from the repo's
--   database/profile_vehicle_rates_fixes.sql but written for the LIVE schema.
--
--   1. public.normalize_plate(text)      -- same normaliser the phone uses.
--   2. public.ensure_my_profile()        -- self-heals a missing profile for
--                                           the SIGNED-IN user; role is ALWAYS
--                                           'customer' (never from metadata).
--   3. public.submit_my_pwd_permit(text) -- a customer records their own PWD
--                                           permit number; it never self-verifies.
--   4. A SELECT policy on rates, so the Reserve screen can read prices.
--      Created ONLY if rates has no SELECT policy at all (the live DB already
--      has "Public can view rates", so this is normally a no-op).
--   5. A DELETE policy so an owner can remove their own vehicle.
--   6. public.handle_new_user() + the on_auth_user_created trigger.
--      *** GATED ON source = 'mobile' *** -- see the big note below.
--   7. A collision-safe plate backfill (cannot raise 23505) and a NOT VALID
--      format check on new/updated plates.
--
-- WHAT IT NEEDS
--   Run 00_preflight_checks.sql first (all rows ok) and 01_fix_booking_code.sql
--   before this. Needs: profiles, vehicles, rates, penalties, audit_log tables
--   and the user_role enum -- all present.
--
-- *** THE AUTH TRIGGER AND THE DESKTOP (important) ***
--   The desktop console creates staff accounts with supabase.auth.signUp(...)
--   and passes metadata that includes a role. If an on_auth_user_created
--   trigger inserted a row for EVERY new auth user, it would collide with the
--   desktop's own profile handling (and could take the role from metadata,
--   which must never happen).
--   So handle_new_user() does TWO safety things:
--     (a) it RETURNS immediately unless the sign-up metadata says
--         source = 'mobile'  -> desktop sign-ups are left completely alone; and
--     (b) it always writes role = 'customer' -> metadata can never set a role.
--   This cannot break the desktop: the trigger does nothing for desktop
--   sign-ups. (It also does not FIX the desktop -- the desktop's staff account
--   flow is the group's own file; see the report.)
--
-- IT NEVER REWRITES EXISTING PEOPLE
--   * ensure_my_profile() inserts only when the caller has no profile row.
--   * handle_new_user() uses ON CONFLICT (id) DO NOTHING.
--   * Nothing here updates or deletes an existing profile, rate or slot row.
--
-- HOW TO VERIFY (after running it; all read-only)
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('normalize_plate','ensure_my_profile','submit_my_pwd_permit','handle_new_user');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.rates'::regclass;
--   -- and the profile count must not have dropped:
--   SELECT COUNT(*) FROM public.profiles;
--
-- SAFE TO RUN TWICE: every statement is CREATE OR REPLACE, IF NOT EXISTS,
-- guarded by pg_policies/pg_trigger lookups, or ON CONFLICT DO NOTHING.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. normalize_plate(raw) -- the database's copy of shared/src/plate.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_plate(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    left(c.cleaned, 3) || translate(substr(c.cleaned, 4), 'OISZB', '01528'),
    ''
  )
  FROM (
    SELECT upper(regexp_replace(COALESCE(raw, ''), '[^A-Za-z0-9]', '', 'g')) AS cleaned
  ) AS c;
$$;

-- ---------------------------------------------------------------------------
-- 2. ensure_my_profile() -- self-heal for the signed-in user. Role: customer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_row   public.profiles;
  v_meta  JSONB;
  v_email TEXT;
  v_name  TEXT;
  v_phone TEXT;
  v_plate TEXT;
  v_type  TEXT;
  v_pwd   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Already there? Return it untouched. (Never rewrites an existing profile.)
  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT u.email, COALESCE(u.raw_user_meta_data, '{}'::jsonb)
    INTO v_email, v_meta
    FROM auth.users u
   WHERE u.id = v_uid;

  v_name  := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type  := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd   := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_plate := public.normalize_plate(v_meta->>'plate_number');

  INSERT INTO public.profiles (id, full_name, email, phone, role, status, pwd_permit_number)
  VALUES (
    v_uid,
    COALESCE(v_name, v_email, 'ParkWise customer'),
    COALESCE(v_email, v_phone, 'unknown@parkwise.local'),
    COALESCE(v_phone, ''),
    'customer',                 -- never taken from metadata
    'active',
    v_pwd
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  END IF;

  -- Guarded: a malformed plate must not create a vehicle here.
  IF v_plate ~ '^[A-Z]{3}[0-9]{3,4}$' THEN
    INSERT INTO public.vehicles (owner_id, plate_number, vehicle_type, is_default)
    VALUES (v_uid, v_plate, COALESCE(v_type, 'four_wheeled'), TRUE)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. submit_my_pwd_permit(p_permit_number) -- the customer records/corrects
--    their own permit number. It ONLY touches pwd_permit_number; pwd_verified
--    stays FALSE until staff verify it, so nobody can self-verify.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_my_pwd_permit(p_permit_number TEXT)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  UPDATE public.profiles
     SET pwd_permit_number = NULLIF(btrim(COALESCE(p_permit_number, '')), '')
   WHERE id = v_uid
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_my_pwd_permit(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_pwd_permit(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. rates: let signed-in users read prices -- only if no SELECT policy exists.
--    The live DB already has "Public can view rates", so this is usually a
--    no-op. The guard is what "only if one does not already exist" means.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'rates' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "Authenticated can read rates" ON public.rates
      FOR SELECT TO authenticated USING (true);
    RAISE NOTICE 'rates: added the "Authenticated can read rates" SELECT policy.';
  ELSE
    RAISE NOTICE 'rates: a SELECT policy already exists; left it as it is.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. vehicles: let an owner remove their own vehicle -- only if no DELETE
--    policy exists yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'vehicles' AND cmd = 'DELETE'
  ) THEN
    CREATE POLICY "Users can delete own vehicles" ON public.vehicles
      FOR DELETE TO authenticated USING (owner_id = auth.uid());
    RAISE NOTICE 'vehicles: added the "Users can delete own vehicles" DELETE policy.';
  ELSE
    RAISE NOTICE 'vehicles: a DELETE policy already exists; left it as it is.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. handle_new_user() + on_auth_user_created -- MOBILE ONLY.
--    Creates the profile (role always 'customer') and, when the sign-up form
--    supplied a valid plate, the customer's first vehicle -- but ONLY when the
--    metadata says source = 'mobile'. Any other sign-up (the desktop console)
--    is returned untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta  JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name  TEXT := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone TEXT := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type  TEXT := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd   TEXT := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_plate TEXT := public.normalize_plate(v_meta->>'plate_number');
BEGIN
  -- SAFETY GATE: only the phone app asks for a profile to be created here.
  -- The desktop console creates staff accounts its own way; leave those alone.
  IF COALESCE(v_meta->>'source', '') <> 'mobile' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, phone, role, status, pwd_permit_number)
  VALUES (
    NEW.id,
    COALESCE(v_name, NEW.email, 'ParkWise customer'),
    COALESCE(NEW.email, v_phone, 'unknown@parkwise.local'),
    COALESCE(v_phone, ''),
    'customer',                 -- never taken from metadata
    'active',
    v_pwd
  )
  ON CONFLICT (id) DO NOTHING;

  -- Guarded: a malformed plate must not fail the whole sign-up.
  IF v_plate ~ '^[A-Z]{3}[0-9]{3,4}$' THEN
    INSERT INTO public.vehicles (owner_id, plate_number, vehicle_type, is_default)
    VALUES (NEW.id, v_plate, COALESCE(v_type, 'four_wheeled'), TRUE)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. vehicles: bring existing plates to the normalised shape, then enforce it.
--    plate_number is UNIQUE, so two legacy rows can normalise to the SAME value
--    ("ABC-1234" and "ABC 1234" both -> "ABC1234"), which would raise 23505 and
--    roll the whole thing back. So ONE row per normalised value wins (lowest
--    plate, then id -- deterministic, so re-running changes nothing) and every
--    other row is left exactly as it is and reported with RAISE NOTICE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_updated INTEGER := 0;
  v_skipped TEXT[] := '{}';
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.id, c.old_plate, c.fixed, c.rn
      FROM (
        SELECT v.id,
               v.plate_number AS old_plate,
               public.normalize_plate(v.plate_number) AS fixed,
               row_number() OVER (
                 PARTITION BY public.normalize_plate(v.plate_number)
                 ORDER BY v.plate_number, v.id
               ) AS rn
          FROM public.vehicles v
      ) c
     WHERE c.fixed ~ '^[A-Z]{3}[0-9]{3,4}$'
       AND c.old_plate IS DISTINCT FROM c.fixed
     ORDER BY c.fixed, c.rn
  LOOP
    IF r.rn > 1 THEN
      v_skipped := v_skipped || format('%s (duplicate of %s)', r.old_plate, r.fixed);
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.vehicles o
       WHERE o.id <> r.id AND o.plate_number = r.fixed
    ) THEN
      v_skipped := v_skipped || format('%s (target %s already in use)', r.old_plate, r.fixed);
      CONTINUE;
    END IF;

    UPDATE public.vehicles SET plate_number = r.fixed WHERE id = r.id;
    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated > 0 THEN
    RAISE NOTICE 'plate backfill: normalised % vehicle(s)', v_updated;
  END IF;
  IF array_length(v_skipped, 1) IS NOT NULL THEN
    RAISE NOTICE 'plate backfill: left % vehicle(s) unchanged -> %',
      array_length(v_skipped, 1), array_to_string(v_skipped, '; ');
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vehicles
    ADD CONSTRAINT vehicles_plate_format_check
    CHECK (plate_number ~ '^[A-Z]{3}[0-9]{3,4}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
