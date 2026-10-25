-- ===========================================================================
-- 18_booking_limits_cache.sql
-- 17_booking_advance_limit.sql added get_booking_limits(), and the mobile
-- app was calling that RPC directly to show/clamp the advance-booking
-- window. That RPC always returns the correct, current numbers - but having
-- the PHONE call it live, on a timer or a realtime refresh, runs into RLS:
-- "Users can view own reservations" only lets a customer SELECT their own
-- rows, and Supabase Realtime enforces that same RLS on postgres_changes.
-- So a client-side subscription to `reservations` can never actually
-- receive another customer's booking/cancellation - the dashboard notice
-- and the reservation screen's clamp would only ever go "live" on the
-- signed-in customer's OWN activity, not on what's actually filling up the
-- lot. (Confirmed live: the existing 08_realtime_publication.sql comment
-- already states realtime only ever sends a subscriber rows they could
-- already SELECT - this migration exists because that's exactly the
-- restriction that blocks this specific feature.)
--
-- Fix: a tiny, public-read, single-row cache table holding just the two
-- numbers - no customer data, so anyone signed in can read it directly, and
-- it's kept current by triggers rather than computed on every read. A
-- public-read table's changes DO reach every realtime subscriber (same as
-- `slots` already does for the floor plan), so this is what actually makes
-- the notice/clamp live across every customer, not just the one holding the
-- phone.
--
-- Depends on 17_booking_advance_limit.sql (get_booking_limits() must
-- already exist).
--
-- Safe to re-run.
-- ===========================================================================

-- booking_limits_cache ------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_limits_cache (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pwd_max_hours NUMERIC NOT NULL DEFAULT 8,
  regular_max_hours NUMERIC NOT NULL DEFAULT 8,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE booking_limits_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view booking limits" ON booking_limits_cache;
CREATE POLICY "Public can view booking limits" ON booking_limits_cache
  FOR SELECT USING (true);

-- Seed the single row from the real current numbers (not just the 8/8
-- default), so this starts out already correct against this database's
-- existing reservation history.
INSERT INTO booking_limits_cache (id, pwd_max_hours, regular_max_hours)
SELECT 1, pwd_max_hours, regular_max_hours FROM get_booking_limits()
ON CONFLICT (id) DO NOTHING;

-- refresh_booking_limits_cache() --------------------------------------------
-- SECURITY DEFINER so the write always succeeds regardless of which role's
-- statement fired the trigger - a customer directly cancelling their own
-- reservation via the RLS-gated "Users can cancel own reservations" policy
-- has no grant on booking_limits_cache themselves.
CREATE OR REPLACE FUNCTION refresh_booking_limits_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE booking_limits_cache bc
  SET pwd_max_hours = l.pwd_max_hours,
      regular_max_hours = l.regular_max_hours,
      updated_at = NOW()
  FROM get_booking_limits() l
  WHERE bc.id = 1;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_refresh_booking_limits ON reservations;
CREATE TRIGGER trg_reservation_refresh_booking_limits
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION refresh_booking_limits_cache();

DROP TRIGGER IF EXISTS trg_slot_refresh_booking_limits ON slots;
CREATE TRIGGER trg_slot_refresh_booking_limits
  AFTER INSERT OR UPDATE OR DELETE ON slots
  FOR EACH ROW EXECUTE FUNCTION refresh_booking_limits_cache();

-- Realtime: the phone subscribes to this table directly now, instead of to
-- reservations/slots. Guarded the same way 08_realtime_publication.sql
-- guards its own ADD TABLE calls - safe to run twice.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_limits_cache;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT * FROM booking_limits_cache WHERE id = 1;
-- Expected: one row, matching what `SELECT * FROM get_booking_limits();`
-- (from migration 17) returns right now.
--
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' AND tablename = 'booking_limits_cache';
-- Expected: one row.
--
-- Live test: book/cancel on one phone while another phone sits on the
-- Dashboard or Reservation screen - the second phone's notice/clamp should
-- update within a second or two, without navigating away and back.
