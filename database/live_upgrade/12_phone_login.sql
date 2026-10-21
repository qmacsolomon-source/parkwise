-- ===========================================================================
-- ParkWise - LIVE upgrade - 12_phone_login.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   LoginScreen.tsx's "Email or Phone" field validates and accepts an
--   11-digit phone number - but it was passed straight through as the
--   literal `email` argument to supabase.auth.signInWithPassword(), which
--   can never match. Anyone who tried logging in with their phone number
--   instead of their email has always failed, silently, with the same
--   generic "please check your credentials" message as a wrong password.
--
--   Adds public.email_for_phone(p_phone) - given a phone number (any
--   formatting; digits are compared, not the raw string), returns the email
--   of the one profile whose phone matches, or NULL if there is no match or
--   more than one (phone was never unique before this). SECURITY DEFINER so
--   it can be called by a signed-OUT client (login happens before auth), and
--   it reveals nothing but an email string - never used to confirm whether a
--   phone number exists on its own.
--
--   Also adds a PARTIAL unique index on profiles.phone, covering only
--   well-formed 11-digit numbers - every blank phone (desktop-created staff
--   rows never collect one) and any odd legacy formatting is left alone, so
--   this can never fail on data that already exists. It's wrapped so that
--   if two real customers already happen to share the exact same 11-digit
--   number, the index is simply skipped (with a NOTICE saying so) rather
--   than failing the whole file - phone lookup would just stay ambiguous
--   (returns NULL) for that one number until the group manually fixes it.
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema - profiles.phone already exists.
--
-- HOW TO VERIFY (read-only)
--   SELECT proname FROM pg_proc WHERE proname = 'email_for_phone';
--   SELECT indexname FROM pg_indexes WHERE indexname = 'profiles_phone_unique_idx';
--   -- both expect 1 row (the index may be missing with a NOTICE explaining
--   -- why - see WHAT IT DOES above - that's not a failure)
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE FUNCTION; the index create is guarded
-- against both "already exists" and "duplicate data" failures.
-- ===========================================================================

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX profiles_phone_unique_idx ON public.profiles (phone)
      WHERE phone ~ '^[0-9]{11}$';
  EXCEPTION
    WHEN duplicate_table THEN
      NULL; -- already created by an earlier run of this file
    WHEN unique_violation THEN
      RAISE NOTICE 'profiles_phone_unique_idx: skipped - two or more existing profiles already share the same 11-digit phone number. Phone login stays ambiguous (returns no match) for whichever number(s) collide, until that is fixed manually.';
  END;
END $$;

-- If a collision somehow exists (the partial unique index above could not
-- be created), this returns NULL rather than silently picking one of two
-- different people's accounts.
CREATE OR REPLACE FUNCTION public.email_for_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails TEXT[];
BEGIN
  SELECT array_agg(email) INTO v_emails
    FROM public.profiles
   WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')
     AND phone ~ '^[0-9]{11}$'
     AND status = 'active';

  IF array_length(v_emails, 1) = 1 THEN
    RETURN v_emails[1];
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.email_for_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_phone(TEXT) TO anon, authenticated;
