-- ParkWise: profile, vehicle and rates fixes
--
-- Run this AFTER schema.sql and rls_policies.sql.
-- Idempotent: every statement can be re-run safely.
--
-- It fixes three problems seen from the customer app:
--   1. Signed-up users had no profiles row (no handle_new_user() existed at
--      all), so Settings showed "Signed in / No email on file" and Home had
--      no name. ensure_my_profile() repairs that for an already signed-in
--      user; handle_new_user() prevents it for new sign-ups.
--   2. The Reserve screen could not read `rates` (missing SELECT policy on a
--      fresh database) and the table could be empty.
--   3. Customers could not delete a vehicle (no DELETE policy on vehicles).
--   4. Removing a vehicle destroyed its booking history (reservations cascade
--      off vehicles), and the plate format was only enforced by the mobile
--      form -- see sections 8 and 9.

-- ---------------------------------------------------------------------------
-- 0. normalize_plate(raw)
--    The database's copy of the plate normaliser in shared/src/plate.ts:
--    uppercase, strip separators, then fix the OCR-style digit confusions
--    (O->0, I->1, S->5, Z->2, B->8) inside the numeric part only. Both
--    triggers below use it so a plate written by the database matches one
--    written by the app.
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


-- pwd_intent: true when the customer checked "I have a PWD permit" at
-- sign-up (no number collected there any more - that's completed later in
-- Settings). Read from sign-up metadata by both functions below.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pwd_intent BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 1. ensure_my_profile()
--    Creates the caller's profile from their auth.users metadata when it is
--    missing, then returns it. The role is ALWAYS 'customer' -- metadata is
--    never trusted for the role. SECURITY DEFINER so RLS on profiles cannot
--    block the repair.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_row        public.profiles;
  v_meta       JSONB;
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
    v_pwd,                      -- seeded from the customer's own sign-up form
    v_pwd_intent
  )
  RETURNING * INTO v_row;

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
-- 2. handle_new_user()
--    Creates the profile (and the customer's first vehicle) as soon as the
--    auth user is inserted. The role is ALWAYS 'customer'; the vehicle is
--    only created when the sign-up form supplied a plate number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta       JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name       TEXT := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
  v_phone      TEXT := NULLIF(btrim(COALESCE(v_meta->>'phone', '')), '');
  v_type       TEXT := NULLIF(btrim(COALESCE(v_meta->>'vehicle_type', '')), '');
  v_pwd        TEXT := NULLIF(btrim(COALESCE(v_meta->>'pwd_permit_number', '')), '');
  v_pwd_intent BOOLEAN := COALESCE((v_meta->>'pwd_intent')::boolean, false);
  v_plate      TEXT := public.normalize_plate(v_meta->>'plate_number');
BEGIN
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. submit_my_pwd_permit(p_permit_number, p_photo_path)
--    Lets a customer record (or correct) their own PWD permit number and the
--    storage path of a photo of the permit. It ONLY touches
--    pwd_permit_number/pwd_permit_photo_path -- pwd_verified stays FALSE
--    until a staff member verifies it, so a customer can never self-verify.
--
--    pwd_permit_photo_path is a path inside the private 'pwd-permits'
--    Storage bucket, shaped "<user-id>/permit-<ts>.<ext>". The function only
--    ever accepts a path inside the caller's own folder, so a customer can
--    never point their profile at someone else's uploaded photo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pwd_permit_photo_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('pwd-permits', 'pwd-permits', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Customers can upload own permit photo" ON storage.objects;
DROP POLICY IF EXISTS "Customers can update own permit photo" ON storage.objects;
DROP POLICY IF EXISTS "Customers can view own permit photo" ON storage.objects;
DROP POLICY IF EXISTS "Staff can view all permit photos" ON storage.objects;

CREATE POLICY "Customers can upload own permit photo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pwd-permits' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can update own permit photo" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'pwd-permits' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'pwd-permits' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can view own permit photo" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'pwd-permits' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Staff can view all permit photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'pwd-permits' AND is_staff());

-- Drop the old one-argument signature first - otherwise it coexists as a
-- separate overload and a call that passes only p_permit_number becomes
-- ambiguous between the two.
DROP FUNCTION IF EXISTS public.submit_my_pwd_permit(TEXT);

CREATE OR REPLACE FUNCTION public.submit_my_pwd_permit(p_permit_number TEXT, p_photo_path TEXT DEFAULT NULL)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.profiles;
  v_photo_path TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_photo_path IS NOT NULL AND p_photo_path LIKE (v_uid::text || '/%') THEN
    v_photo_path := p_photo_path;
  ELSE
    v_photo_path := NULL;
  END IF;

  UPDATE public.profiles
     SET pwd_permit_number = NULLIF(btrim(COALESCE(p_permit_number, '')), ''),
         pwd_permit_photo_path = COALESCE(v_photo_path, pwd_permit_photo_path)
   WHERE id = v_uid
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_my_pwd_permit(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_pwd_permit(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. request_my_account_deletion()
--    Records a deletion request for staff to action. It does NOT delete the
--    account (unpaid penalties may be outstanding), it writes an audit entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_my_account_deletion()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_penalty  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_penalty
    FROM public.penalties
   WHERE customer_id = v_uid AND status = 'unpaid';

  INSERT INTO public.audit_log (actor_id, action, details)
  VALUES (
    v_uid,
    'account_deletion_requested',
    jsonb_build_object('requested_at', now(), 'source', 'mobile', 'unpaid_penalties', v_penalty)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_my_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_my_account_deletion() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. rates: readable by signed-in customers + never empty
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read rates" ON public.rates;
CREATE POLICY "Authenticated can read rates" ON public.rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

INSERT INTO public.rates (
  hourly_rate,
  overstay_per_hour,
  no_show_penalty,
  late_cancel_penalty,
  late_cancel_window_minutes,
  grace_period_minutes,
  updated_by
)
SELECT 50, 100, 100, 50, 30, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.rates);

-- ---------------------------------------------------------------------------
-- 6. vehicles: let an owner delete their own vehicle
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete own vehicles" ON public.vehicles
  FOR DELETE USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. profiles: a customer may edit their own name and phone, but must never be
--    able to grant themselves a role, re-enable a disabled account or mark
--    their own PWD permit verified. RLS cannot restrict an UPDATE to single
--    columns, so a BEFORE trigger pins those three columns back to their old
--    values for any non-staff caller. Requests with no end user (the SQL
--    editor, service_role, migrations) are left untouched.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8. vehicles: removing a car must never destroy its booking history
--    reservations (and the payments and penalties that cascade off them)
--    hang off vehicles, so a hard DELETE on a vehicle used to wipe all of it.
--    The app now only archives a used vehicle (is_active = FALSE); the
--    RESTRICT below is the database's own guarantee that a vehicle with
--    history can never be hard-deleted by anything.
-- ---------------------------------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_vehicle_id_fkey;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 9. vehicles: the plate format is a database rule, not only a form rule
--    The mobile form checks 3 letters + 3 or 4 digits, but the desktop
--    console, Manual Entry and the agent service write to this table too.
--    First bring every existing plate to the normalised shape, then enforce
--    the format on new and updated rows. NOT VALID leaves any row that is
--    still malformed exactly as it is.
--
--    The backfill cannot be a plain UPDATE: plate_number is UNIQUE and two
--    legacy rows can normalise to the SAME value ("ABC-1234" and "ABC 1234"
--    both become "ABC1234"), which would raise 23505 and roll the whole
--    statement back. So one row per normalised value wins (the lowest
--    plate_number, then id -- deterministic, so re-running changes nothing)
--    and every other row keeps its plate and is reported with RAISE NOTICE.
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
    -- A second legacy row normalising to the same plate: leave it alone.
    IF r.rn > 1 THEN
      v_skipped := v_skipped || format('%s (duplicate of %s)', r.old_plate, r.fixed);
      CONTINUE;
    END IF;

    -- That plate already belongs to a different vehicle: leave it alone.
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
