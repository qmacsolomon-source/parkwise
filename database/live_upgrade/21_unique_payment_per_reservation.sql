-- ===========================================================================
-- 21_unique_payment_per_reservation.sql
-- CashPayment.tsx checks for an existing payment on a reservation before
-- inserting a new one (handleConfirmPayment()), but that check-then-insert
-- has a real TOCTOU race with no DB-level guard behind it: two attendant
-- stations confirming payment on the same reservation within the same
-- window could both pass the check and insert duplicate payment rows. The
-- UI's own "processing" disable only protects against the same attendant
-- double-clicking, not a second station. Only one insert site for payments
-- exists in the whole codebase (CashPayment.tsx), and it's always meant to
-- be the single checkout payment for that reservation - never more than
-- one - so a UNIQUE constraint is safe.
--
-- IMPORTANT: if this database already has duplicate payment rows for the
-- same reservation (from exactly the race this migration closes), adding
-- the constraint will fail. Run the check query below FIRST; if it returns
-- any rows, decide which duplicate to keep/refund before running this file.
--
-- Safe to re-run: Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this is
-- guarded the same way 08_realtime_publication.sql guards its own
-- idempotent ALTER statements.
-- ===========================================================================

-- Run this first. Expected: no rows.
-- SELECT reservation_id, COUNT(*) FROM payments GROUP BY reservation_id HAVING COUNT(*) > 1;

DO $$
BEGIN
  BEGIN
    ALTER TABLE payments ADD CONSTRAINT payments_reservation_id_key UNIQUE (reservation_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------
-- SELECT conname FROM pg_constraint WHERE conname = 'payments_reservation_id_key';
-- Expected: one row.
