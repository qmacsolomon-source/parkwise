-- ===========================================================================
-- ParkWise - LIVE upgrade - 09_profile_name_parts.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Registration used to collect one "Full Name" field. The phone now asks
--   for First Name / Middle Name (optional) / Surname separately. This adds:
--     1. profiles.first_name, profiles.middle_name, profiles.last_name
--        (all nullable TEXT - null for every row that existed before this,
--        and for staff accounts, which the desktop console still creates
--        with full_name only and no name-parts concept at all).
--     2. handle_new_user() and ensure_my_profile() now read first_name/
--        last_name/middle_name out of the sign-up metadata and store all
--        three PLUS a computed full_name (first + middle + last, joined with
--        spaces, blanks skipped) - so every existing reader of
--        profiles.full_name (desktop reports, payment logs, notifications,
--        account creation, user management - 20+ call sites) keeps working
--        completely unchanged. If the metadata has no first_name (an old
--        app build, or a non-mobile sign-up), it falls back to the old
--        full_name metadata key exactly like before.
--
-- WHAT IT NEEDS
--   02_profile_vehicle_rates_upgrade.sql and 05_pwd_intent.sql already run
--   (this replaces both functions again, keeping everything they already do).
--
-- HOW TO VERIFY (read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--      AND column_name IN ('first_name','middle_name','last_name');
--   -- expect 3 rows
--
-- SAFE TO RUN TWICE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ===========================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name  TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name   TEXT;

-- ---------------------------------------------------------------------------
-- handle_new_user(): same as 05's version, plus name parts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta       JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_first      TEXT := NULLIF(btrim(COALESCE(v_meta->>'first_name', '')), '');
  v_middle     TEXT := NULLIF(btrim(COALESCE(v_meta->>'middle_name', '')), '');
  v_last       TEXT := NULLIF(btrim(COALESCE(v_meta->>'last_name', '')), '');
  v_name       TEXT := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone      TEXT := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type       TEXT := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd        TEXT := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_pwd_intent BOOLEAN := COALESCE((v_meta->>'pwd_intent')::boolean, false);
  v_plate      TEXT := public.normalize_plate(v_meta->>'plate_number');
  v_full_name  TEXT;
BEGIN
  -- SAFETY GATE: only the phone app asks for a profile to be created here.
  -- The desktop console creates staff accounts its own way; leave those alone.
  IF COALESCE(v_meta->>'source', '') <> 'mobile' THEN
    RETURN NEW;
  END IF;

  -- Prefer the split name parts; fall back to the old single full_name
  -- metadata key for an older app build that never sends name parts.
  IF v_first IS NOT NULL OR v_last IS NOT NULL THEN
    v_full_name := NULLIF(btrim(concat_ws(' ', v_first, v_middle, v_last)), '');
  ELSE
    v_full_name := v_name;
  END IF;

  INSERT INTO public.profiles
    (id, full_name, first_name, middle_name, last_name, email, phone, role, status, pwd_permit_number, pwd_intent)
  VALUES (
    NEW.id,
    COALESCE(v_full_name, NEW.email, 'ParkWise customer'),
    v_first,
    v_middle,
    v_last,
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
-- ensure_my_profile(): same as 05's version, plus name parts.
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
  v_first      TEXT;
  v_middle     TEXT;
  v_last       TEXT;
  v_name       TEXT;
  v_phone      TEXT;
  v_plate      TEXT;
  v_type       TEXT;
  v_pwd        TEXT;
  v_pwd_intent BOOLEAN;
  v_full_name  TEXT;
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

  v_first      := NULLIF(btrim(COALESCE(v_meta->>'first_name', '')), '');
  v_middle     := NULLIF(btrim(COALESCE(v_meta->>'middle_name', '')), '');
  v_last       := NULLIF(btrim(COALESCE(v_meta->>'last_name', '')), '');
  v_name       := NULLIF(btrim(COALESCE(v_meta->>'full_name', '')), '');
  v_phone      := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type       := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd        := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_pwd_intent := COALESCE((v_meta->>'pwd_intent')::boolean, false);
  v_plate      := public.normalize_plate(v_meta->>'plate_number');

  IF v_first IS NOT NULL OR v_last IS NOT NULL THEN
    v_full_name := NULLIF(btrim(concat_ws(' ', v_first, v_middle, v_last)), '');
  ELSE
    v_full_name := v_name;
  END IF;

  INSERT INTO public.profiles
    (id, full_name, first_name, middle_name, last_name, email, phone, role, status, pwd_permit_number, pwd_intent)
  VALUES (
    v_uid,
    COALESCE(v_full_name, v_email, 'ParkWise customer'),
    v_first,
    v_middle,
    v_last,
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
