-- ===========================================================================
-- ParkWise - LIVE upgrade - 04_pwd_permit_photo.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Adds photo evidence to PWD permit verification, so staff are not just
--   trusting a typed-in number.
--     1. profiles.pwd_permit_photo_path (text, nullable) - the storage path
--        of the customer's uploaded permit photo.
--     2. A PRIVATE 'pwd-permits' Storage bucket (not publicly readable).
--     3. Storage policies: a customer may upload/update/view objects only
--        under their own "<their-user-id>/..." folder inside the bucket;
--        staff (is_staff()) may view any object in the bucket so they can
--        verify it, but cannot upload to it.
--     4. submit_my_pwd_permit() is replaced to also accept an optional photo
--        path. It only ever stores a path that starts with the caller's own
--        user id, so a customer can never point their profile at someone
--        else's uploaded photo even by passing an arbitrary string.
--
-- WHAT IT NEEDS
--   02_profile_vehicle_rates_upgrade.sql already run (creates the original
--   one-argument submit_my_pwd_permit(text), which this replaces).
--
-- HOW TO VERIFY (after running it; all read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--      AND column_name='pwd_permit_photo_path';
--   SELECT id, public FROM storage.buckets WHERE id = 'pwd-permits';
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'storage.objects'::regclass AND polname ILIKE '%permit photo%';
--   -- expect 4 rows: upload, update, view-own, staff-view-all
--
-- SAFE TO RUN TWICE: ADD COLUMN IF NOT EXISTS, bucket insert guarded by
-- ON CONFLICT DO NOTHING, DROP POLICY IF EXISTS before each CREATE POLICY,
-- CREATE OR REPLACE FUNCTION.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.pwd_permit_photo_path
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pwd_permit_photo_path TEXT;

-- ---------------------------------------------------------------------------
-- 2. Private storage bucket for the photos.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('pwd-permits', 'pwd-permits', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Storage policies. Objects are stored as "<user-id>/permit-<ts>.<ext>",
--    so (storage.foldername(name))[1] is the owning user's id.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. submit_my_pwd_permit(): now also takes the uploaded photo's storage
--    path. pwd_verified is never touched here, so nobody can self-verify.
--    The old one-argument version from 02 is dropped first - otherwise it
--    coexists as a separate overload and a call that passes only
--    p_permit_number becomes ambiguous between the two.
-- ---------------------------------------------------------------------------
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

  -- Only ever store a path inside the caller's own folder - never trust the
  -- client to point this at someone else's upload.
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
