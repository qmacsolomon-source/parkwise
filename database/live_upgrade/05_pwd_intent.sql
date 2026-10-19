-- ===========================================================================
-- ParkWise - LIVE upgrade - 05_pwd_intent.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Registration no longer asks for a permit NUMBER up front - just a yes/no
--   "do you have a PWD permit?" checkbox. This adds somewhere to remember
--   that "yes" so the app can steer that customer to finish verification
--   (number + photo, in Settings) the first time they log in, instead of the
--   old flow of collecting an unverified number at sign-up time.
--     1. profiles.pwd_intent (boolean, not null, default false) - true when
--        the customer checked "I have a PWD permit" at sign-up.
--     2. handle_new_user() and ensure_my_profile() both read a `pwd_intent`
--        boolean out of the sign-up metadata (mobile-only, same as every
--        other field they already read) and store it.
--
-- WHAT IT NEEDS
--   02_profile_vehicle_rates_upgrade.sql already run (creates both functions
--   this replaces).
--
-- HOW TO VERIFY (read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles' AND column_name='pwd_intent';
--   SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) LIKE '%pwd_intent%';
--   SELECT pg_get_functiondef('public.ensure_my_profile()'::regprocedure) LIKE '%pwd_intent%';
--   -- all should be true / return a row
--
-- SAFE TO RUN TWICE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pwd_intent BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- handle_new_user(): same as 02's version, plus pwd_intent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta       JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name       TEXT := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone      TEXT := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type       TEXT := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd        TEXT := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_pwd_intent BOOLEAN := COALESCE((v_meta->>'pwd_intent')::boolean, false);
  v_plate      TEXT := public.normalize_plate(v_meta->>'plate_number');
BEGIN
  -- SAFETY GATE: only the phone app asks for a profile to be created here.
  -- The desktop console creates staff accounts its own way; leave those alone.
  IF COALESCE(v_meta->>'source', '') <> 'mobile' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, phone, role, status, pwd_permit_number, pwd_intent)
  VALUES (
    NEW.id,
    COALESCE(v_name, NEW.email, 'ParkWise customer'),
    COALESCE(NEW.email, v_phone, 'unknown@parkwise.local'),
    COALESCE(v_phone, ''),
    'customer',                 -- never taken from metadata
    'active',
    v_pwd,
    v_pwd_intent
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

-- ---------------------------------------------------------------------------
-- ensure_my_profile(): same as 02's version, plus pwd_intent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_meta       JSONB;
  v_row        public.profiles;
  v_email      TEXT;
  v_name       TEXT;
  v_phone      TEXT;
  v_plate      TEXT;
  v_type       TEXT;
  v_pwd        TEXT;
  v_pwd_intent BOOLEAN;
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

  v_name       := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone      := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type       := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd        := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_pwd_intent := COALESCE((v_meta->>'pwd_intent')::boolean, false);
  v_plate      := public.normalize_plate(v_meta->>'plate_number');

  INSERT INTO public.profiles (id, full_name, email, phone, role, status, pwd_permit_number, pwd_intent)
  VALUES (
    v_uid,
    COALESCE(v_name, v_email, 'ParkWise customer'),
    COALESCE(v_email, v_phone, 'unknown@parkwise.local'),
    COALESCE(v_phone, ''),
    'customer',                 -- never taken from metadata
    'active',
    v_pwd,
    v_pwd_intent
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
