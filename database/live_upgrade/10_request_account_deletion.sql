-- ===========================================================================
-- ParkWise - LIVE upgrade - 10_request_account_deletion.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   mobile/src/screens/SettingsScreen.tsx has a full "Request account
--   deletion" flow already built - it calls authService.requestAccountDeletion(),
--   which calls the database function public.request_my_account_deletion().
--   That function has existed in the repo's fresh-install baseline script for
--   a while, but - same gap as vehicles.is_active (07) - was never carried
--   into the live_upgrade path, so the live database never had it. Tapping
--   "Send request" on the live project currently fails with a
--   "function ... does not exist" error shown to the customer as
--   "Could not send your request."
--
--   Adds public.request_my_account_deletion(): records a deletion request as
--   an audit_log entry (actor, timestamp, any outstanding unpaid penalty
--   total) for staff to action manually. It does NOT delete anything itself.
--
-- WHAT IT NEEDS
--   Nothing beyond the base schema - profiles, penalties and audit_log all
--   already exist live (audit_log is already used by login logging).
--
-- HOW TO VERIFY (read-only)
--   SELECT proname FROM pg_proc WHERE proname = 'request_my_account_deletion';
--   -- expect 1 row
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE FUNCTION.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.request_my_account_deletion()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_penalty NUMERIC;
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
