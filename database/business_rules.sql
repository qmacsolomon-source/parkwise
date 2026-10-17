-- ParkWise Business Rules - Functions and Triggers
-- Run this after rls_policies.sql

-- Function: Check if customer has unpaid penalties
CREATE OR REPLACE FUNCTION has_unpaid_penalties(customer_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM penalties
    WHERE customer_id = customer_uuid
    AND status = 'unpaid'
  );
END;
$$ LANGUAGE plpgsql;

-- Function: Check if user is PWD verified
CREATE OR REPLACE FUNCTION is_pwd_verified(customer_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = customer_uuid
    AND pwd_verified = TRUE
  );
END;
$$;

-- Function: Generate unique booking code
CREATE OR REPLACE FUNCTION generate_booking_code()
RETURNS TEXT AS $$
DECLARE
  code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    code := 'PW-' || upper(substring(encode(gen_random_bytes(4), 'hex'), 1, 8));
    SELECT EXISTS(SELECT 1 FROM reservations WHERE booking_code = code) INTO code_exists;
    IF NOT code_exists THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function: Update slot status based on reservation
CREATE OR REPLACE FUNCTION update_slot_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- When reservation is created, mark slot as reserved
    UPDATE slots SET status = 'reserved', current_reservation_id = NEW.id
    WHERE id = NEW.slot_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Update slot status based on reservation status
    IF NEW.status = 'active' THEN
      UPDATE slots SET status = 'occupied', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'verified' THEN
      UPDATE slots SET status = 'occupied', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'completed' OR NEW.status = 'cancelled' OR NEW.status = 'no_show' THEN
      UPDATE slots SET status = 'available', current_reservation_id = NULL
      WHERE id = NEW.slot_id;
    ELSIF NEW.status = 'overstay' THEN
      UPDATE slots SET status = 'overstay', current_reservation_id = NEW.id
      WHERE id = NEW.slot_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- When reservation is deleted, free up the slot
    UPDATE slots SET status = 'available', current_reservation_id = NULL
    WHERE id = OLD.slot_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Prevent reservations for customers with unpaid penalties
CREATE OR REPLACE FUNCTION check_unpaid_penalties()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF has_unpaid_penalties(NEW.customer_id) THEN
      RAISE EXCEPTION 'Cannot create reservation: Customer has unpaid penalties';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Prevent PWD slot reservations by non-verified accounts
CREATE OR REPLACE FUNCTION check_pwd_slot_access()
RETURNS TRIGGER AS $$
DECLARE
  slot_is_pwd BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT is_pwd INTO slot_is_pwd FROM slots WHERE id = NEW.slot_id;
    
    IF slot_is_pwd = TRUE AND NOT is_pwd_verified(NEW.customer_id) THEN
      RAISE EXCEPTION 'PWD slots can only be reserved by accounts with PWD verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-generate booking code
CREATE OR REPLACE FUNCTION set_booking_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_code IS NULL OR NEW.booking_code = '' THEN
    NEW.booking_code := generate_booking_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Create notification
--
-- SECURITY DEFINER is required here, not optional: this is called from
-- triggers to notify a CUSTOMER (e.g. NEW.customer_id on a reservation)
-- while running as whichever role performed the action -- an attendant
-- creating a walk-in's reservation, say. Postgres enforces the SELECT
-- policy on the INSERT's RETURNING clause too, and "Users can view own
-- notifications" only allows user_id = auth.uid(). Without SECURITY
-- DEFINER, inserting a notification for anyone but yourself throws "new
-- row violates row-level security policy for table notifications" and
-- rolls back whatever triggered it -- which silently broke every
-- attendant-created reservation.
CREATE OR REPLACE FUNCTION create_notification(
  user_uuid UUID,
  notif_title TEXT,
  notif_body TEXT,
  notif_type notification_type,
  related_reservation UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, body, type, related_reservation_id)
  VALUES (user_uuid, notif_title, notif_body, notif_type, related_reservation)
  RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;

-- Function: Log audit entry
--
-- SECURITY DEFINER for the same reason as create_notification() above: the
-- audit_log SELECT policies only cover "your own entries" or "admin sees
-- everything" -- a plain attendant (not admin) logging an entry whose
-- actor_id is the walk-in customer, not themselves, would fail the
-- RETURNING clause's implicit SELECT check otherwise. This was masked
-- during testing because the test account happened to be an admin.
CREATE OR REPLACE FUNCTION log_audit(
  actor_uuid UUID,
  action_text TEXT,
  audit_details JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO audit_log (actor_id, action, details)
  VALUES (actor_uuid, action_text, audit_details)
  RETURNING id INTO audit_id;
  RETURN audit_id;
END;
$$;

-- Trigger: Create notification on reservation creation
CREATE OR REPLACE FUNCTION notify_reservation_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_notification(
    NEW.customer_id,
    'Reservation Created',
    'Your reservation ' || NEW.booking_code || ' has been created successfully.',
    'reservation',
    NEW.id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Create notification on reservation status change
CREATE OR REPLACE FUNCTION notify_reservation_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'verified' THEN
      PERFORM create_notification(
        NEW.customer_id,
        'Reservation Verified',
        'Your reservation ' || NEW.booking_code || ' has been verified.',
        'verification',
        NEW.id
      );
    ELSIF NEW.status = 'cancelled' THEN
      PERFORM create_notification(
        NEW.customer_id,
        'Reservation Cancelled',
        'Your reservation ' || NEW.booking_code || ' has been cancelled.',
        'reservation',
        NEW.id
      );
    ELSIF NEW.status = 'no_show' THEN
      PERFORM create_notification(
        NEW.customer_id,
        'No Show Penalty',
        'You missed your reservation ' || NEW.booking_code || '. A penalty has been applied.',
        'penalty',
        NEW.id
      );
    ELSIF NEW.status = 'overstay' THEN
      PERFORM create_notification(
        NEW.customer_id,
        'Overstay Detected',
        'Your vehicle has overstayed the reservation time. Additional charges may apply.',
        'penalty',
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Create a penalty row when a reservation transitions into a
-- penalty-worthy status. Previously nothing ever inserted into `penalties`
-- even though notify_reservation_status_change() told customers "a penalty
-- has been applied" on no_show/overstay -- this is what actually applies it.
-- Each penalty type fires at most once per reservation (guarded by a
-- NOT EXISTS check against `penalties`, not just OLD/NEW status, so a later
-- unrelated UPDATE on the same row can never insert a duplicate).
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
        -- Flat, one-time charge for symmetry with no_show/late_cancel below.
        -- This is a SEPARATE line item from the metered, per-hour
        -- overstay_surcharge computed in calculate_payment(); rates has no
        -- dedicated flat "overstay_penalty" column, so overstay_per_hour is
        -- reused here as that flat amount. See report for the ambiguity this
        -- creates (possible double charge against the same overstay event).
        INSERT INTO penalties (customer_id, reservation_id, type, amount)
        VALUES (NEW.customer_id, NEW.id, 'overstay', rate.overstay_per_hour);
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

-- Trigger: Log audit on reservation changes
CREATE OR REPLACE FUNCTION audit_reservation_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_audit(
      NEW.customer_id,
      'reservation_created',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'booking_code', NEW.booking_code,
        'slot_id', NEW.slot_id,
        'start_time', NEW.start_time,
        'end_time', NEW.end_time
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM log_audit(
        NEW.customer_id,
        'reservation_status_changed',
        jsonb_build_object(
          'reservation_id', NEW.id,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM log_audit(
      OLD.customer_id,
      'reservation_deleted',
      jsonb_build_object('reservation_id', OLD.id, 'booking_code', OLD.booking_code)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger: Log audit on payment creation
CREATE OR REPLACE FUNCTION audit_payment_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM log_audit(
    NEW.attendant_id,
    'payment_processed',
    jsonb_build_object(
      'payment_id', NEW.id,
      'reservation_id', NEW.reservation_id,
      'total', NEW.total,
      'amount_received', NEW.amount_received,
      'change_given', NEW.change_given
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
--
-- Each is preceded by DROP TRIGGER IF EXISTS so this whole file can be safely
-- re-run after a schema tweak (same idempotent convention as schema.sql),
-- instead of erroring out on "trigger already exists" at the first one.

-- Reservation triggers
DROP TRIGGER IF EXISTS trg_reservation_check_penalties ON reservations;
CREATE TRIGGER trg_reservation_check_penalties
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION check_unpaid_penalties();

DROP TRIGGER IF EXISTS trg_reservation_check_pwd ON reservations;
CREATE TRIGGER trg_reservation_check_pwd
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION check_pwd_slot_access();

DROP TRIGGER IF EXISTS trg_reservation_set_booking_code ON reservations;
CREATE TRIGGER trg_reservation_set_booking_code
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_booking_code();

DROP TRIGGER IF EXISTS trg_reservation_update_slot ON reservations;
CREATE TRIGGER trg_reservation_update_slot
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_slot_status();

DROP TRIGGER IF EXISTS trg_reservation_notify_created ON reservations;
CREATE TRIGGER trg_reservation_notify_created
  AFTER INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION notify_reservation_created();

DROP TRIGGER IF EXISTS trg_reservation_notify_status ON reservations;
CREATE TRIGGER trg_reservation_notify_status
  AFTER UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION notify_reservation_status_change();

DROP TRIGGER IF EXISTS trg_reservation_create_penalty ON reservations;
CREATE TRIGGER trg_reservation_create_penalty
  AFTER UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION create_penalty_on_status_change();

DROP TRIGGER IF EXISTS trg_reservation_audit ON reservations;
CREATE TRIGGER trg_reservation_audit
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION audit_reservation_changes();

-- Payment triggers
DROP TRIGGER IF EXISTS trg_payment_audit ON payments;
CREATE TRIGGER trg_payment_audit
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_payment_created();

-- Function: Get available slots for a time range
CREATE OR REPLACE FUNCTION get_available_slots(
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  require_pwd BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  slot_id UUID,
  slot_code TEXT,
  is_pwd BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.slot_code, s.is_pwd
  FROM slots s
  WHERE s.status = 'available'
  AND (require_pwd = FALSE OR s.is_pwd = TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.slot_id = s.id
    AND r.status NOT IN ('cancelled', 'completed', 'no_show')
    AND r.start_time < end_time
    AND r.end_time > start_time
  )
  ORDER BY s.slot_code;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate payment amount
CREATE OR REPLACE FUNCTION calculate_payment(
  reservation_uuid UUID
)
RETURNS JSONB AS $$
DECLARE
  res RECORD;
  rate RECORD;
  duration_hours NUMERIC;
  base_charge NUMERIC;
  overstay_hours NUMERIC;
  overstay_surcharge NUMERIC;
  penalty_total NUMERIC;
  total NUMERIC;
BEGIN
  SELECT * INTO res FROM reservations WHERE id = reservation_uuid;
  SELECT * INTO rate FROM rates ORDER BY updated_at DESC LIMIT 1;
  
  -- Calculate duration
  duration_hours := EXTRACT(EPOCH FROM (res.end_time - res.start_time)) / 3600;
  
  -- Base charge
  base_charge := CEIL(duration_hours) * rate.hourly_rate;
  
  -- Overstay calculation (if status is overstay)
  overstay_hours := 0;
  overstay_surcharge := 0;
  IF res.status = 'overstay' THEN
    -- Grace period: rates.grace_period_minutes is how many minutes past
    -- end_time are free before overstay billing starts. Previously this
    -- was not applied at all (overstay_hours counted from end_time with no
    -- gate, while a hardcoded 60-second value lived only in agent-service
    -- config, unrelated to this admin-editable setting).
    IF NOW() > (res.end_time + (rate.grace_period_minutes * INTERVAL '1 minute')) THEN
      -- Assume overstay is calculated from end_time to current time
      overstay_hours := EXTRACT(EPOCH FROM (NOW() - res.end_time)) / 3600;
      overstay_surcharge := CEIL(overstay_hours) * rate.overstay_per_hour;
    END IF;
  END IF;
  
  -- Calculate penalties
  SELECT COALESCE(SUM(amount), 0) INTO penalty_total
  FROM penalties
  WHERE reservation_id = reservation_uuid AND status = 'unpaid';
  
  -- Total
  total := base_charge + overstay_surcharge + penalty_total;
  
  RETURN jsonb_build_object(
    'base_charge', base_charge,
    'overstay_surcharge', overstay_surcharge,
    'penalty_total', penalty_total,
    'total', total,
    'duration_hours', duration_hours,
    'overstay_hours', overstay_hours
  );
END;
$$ LANGUAGE plpgsql;
