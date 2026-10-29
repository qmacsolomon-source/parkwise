-- ===========================================================================
-- ParkWise - LIVE upgrade - 23_fix_overstay_double_charge.sql
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--   Fixes a confirmed billing bug: every overstay reservation was charged
--   TWICE for its first hour of overstay - once as a flat `penalties` row
--   (amount = rates.overstay_per_hour, inserted the moment status flips to
--   'overstay'), and again as the metered overstay_surcharge computed fresh
--   at payment time (CEIL(hours overstayed) * rates.overstay_per_hour,
--   which already covers hour one). This re-creates
--   create_penalty_on_status_change() with that flat row's amount changed
--   from rates.overstay_per_hour to 0.
--
--   The row is kept (not removed entirely) at amount=0 so:
--   - has_unpaid_penalties() still blocks a customer with an unresolved
--     overstay from booking a new slot elsewhere.
--   - CashPayment.tsx still has a row to mark 'paid' alongside the real,
--     correctly-metered overstay_surcharge it already charges.
--
-- WHAT IT NEEDS
--   The `penalties`, `reservations`, `rates` tables and the
--   trg_reservation_create_penalty trigger - all already in place since
--   business_rules.sql.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE.
-- ===========================================================================

CREATE OR REPLACE FUNCTION create_penalty_on_status_change()
RETURNS TRIGGER AS $$
DECLARE
  rate RECORD;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT * INTO rate FROM rates ORDER BY updated_at DESC LIMIT 1;

    IF NEW.status = 'no_show' THEN
      IF NOT EXISTS (
        SELECT 1 FROM penalties WHERE reservation_id = NEW.id AND type = 'no_show'
      ) THEN
        INSERT INTO penalties (customer_id, reservation_id, type, amount)
        VALUES (NEW.customer_id, NEW.id, 'no_show', rate.no_show_penalty);
      END IF;

    ELSIF NEW.status = 'overstay' THEN
      IF NOT EXISTS (
        SELECT 1 FROM penalties WHERE reservation_id = NEW.id AND type = 'overstay'
      ) THEN
        -- amount = 0, deliberately: the REAL overstay charge is the metered,
        -- per-hour overstay_surcharge computed fresh at payment time
        -- (calculate_payment() below, mirrored in CashPayment.tsx), which
        -- already covers the full overstayed duration starting from hour
        -- one. Charging rate.overstay_per_hour AGAIN here double-billed
        -- every single overstay by one extra hour - confirmed, not just
        -- "possible" as this comment used to hedge. This row still exists
        -- (at 0) so has_unpaid_penalties() keeps blocking new bookings for a
        -- customer with an unresolved overstay, and so the row is still
        -- there for CashPayment.tsx to mark 'paid' alongside the real charge.
        INSERT INTO penalties (customer_id, reservation_id, type, amount)
        VALUES (NEW.customer_id, NEW.id, 'overstay', 0);
      END IF;

    ELSIF NEW.status = 'cancelled' AND OLD.status IN ('active', 'pending') THEN
      -- Late cancel: cancelling at or after (start_time - window) counts as late.
      IF NOW() > (NEW.start_time - (rate.late_cancel_window_minutes * INTERVAL '1 minute')) THEN
        IF NOT EXISTS (
          SELECT 1 FROM penalties WHERE reservation_id = NEW.id AND type = 'late_cancel'
        ) THEN
          INSERT INTO penalties (customer_id, reservation_id, type, amount)
          VALUES (NEW.customer_id, NEW.id, 'late_cancel', rate.late_cancel_penalty);
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Check (read-only)
-- ---------------------------------------------------------------------------
-- SELECT amount FROM penalties WHERE type = 'overstay' ORDER BY created_at DESC LIMIT 5;
-- Expected: every NEW overstay penalty row from now on has amount = 0.
-- Existing old rows (amount = the flat charge) are untouched by this
-- function change - if any are still unpaid, settle them manually or let
-- the next payment on that reservation collect them as-is.
