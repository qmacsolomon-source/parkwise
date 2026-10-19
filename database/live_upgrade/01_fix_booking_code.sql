-- ===========================================================================
-- ParkWise - LIVE upgrade - 01_fix_booking_code.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Replaces generate_booking_code() with a body that no longer calls
--   gen_random_bytes(). The live version of this function used
--   gen_random_bytes(), which lives in the pgcrypto extension -- and pgcrypto
--   is NOT enabled on the live database. That is why creating a reservation
--   fails with "function gen_random_bytes(integer) does not exist" (42883).
--
--   The replacement uses gen_random_uuid() instead. gen_random_uuid() is a
--   PostgreSQL built-in (pg_catalog), so it resolves even inside a function
--   whose search_path is pinned to public -- no extension required.
--
-- WHAT IT NEEDS
--   Nothing beyond the reservations table (checked by 00_preflight_checks.sql).
--   The signature is unchanged: generate_booking_code() RETURNS TEXT, the same
--   one the live database already has, so CREATE OR REPLACE simply swaps the
--   body. Nothing calls it with different arguments.
--
-- PRESERVED BEHAVIOUR
--   * Same signature  : generate_booking_code() RETURNS TEXT
--   * Same format     : 'PW-' followed by 8 UPPERCASE hex characters
--   * Same uniqueness : loops until the code is not already in
--                       reservations.booking_code
--   Only the source of randomness changes (gen_random_bytes -> gen_random_uuid).
--
-- HOW TO VERIFY (run these AFTER this file; they change nothing)
--   SELECT generate_booking_code();                       -- expect one PW-XXXXXXXX value
--   SELECT generate_booking_code() <> generate_booking_code();  -- expect true (not a constant)
--   SELECT pg_get_functiondef('public.generate_booking_code()'::regprocedure);
--                                                        -- the body must NOT contain gen_random_bytes
--   Then make one booking from the phone: it must save instead of erroring 42883.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE only. It drops no data and no table.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.generate_booking_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  code        TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    -- Built-in only: gen_random_uuid() lives in pg_catalog, so this keeps
    -- working even when a caller pins search_path (SET search_path = public).
    -- gen_random_bytes() came from the pgcrypto extension, which nothing in
    -- this project creates.
    code := 'PW-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    SELECT EXISTS (SELECT 1 FROM public.reservations WHERE booking_code = code)
      INTO code_exists;

    IF NOT code_exists THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$;
