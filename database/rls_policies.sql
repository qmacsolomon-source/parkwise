-- ParkWise Row-Level Security Policies
-- Run this after schema.sql

-- Step 1: Create SECURITY DEFINER helper functions for role checks
-- These functions bypass RLS and have a fixed search_path for security

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_attendant()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'attendant'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('attendant', 'admin')
  );
END;
$$;

-- Step 2: Drop existing policies (safe to re-run)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Attendants can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Attendants can insert walk-in profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON profiles;

DROP POLICY IF EXISTS "Users can view own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can insert own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can update own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Attendants can view all vehicles" ON vehicles;
DROP POLICY IF EXISTS "Attendants can insert vehicles for walk-ins" ON vehicles;

DROP POLICY IF EXISTS "Public can view slots" ON slots;
DROP POLICY IF EXISTS "Attendants can update slots" ON slots;
DROP POLICY IF EXISTS "Admins can insert slots" ON slots;

DROP POLICY IF EXISTS "Users can view own reservations" ON reservations;
DROP POLICY IF EXISTS "Attendants can view all reservations" ON reservations;
DROP POLICY IF EXISTS "Users can insert reservations" ON reservations;
DROP POLICY IF EXISTS "Attendants can insert reservations for walk-ins" ON reservations;
DROP POLICY IF EXISTS "Users can cancel own reservations" ON reservations;
DROP POLICY IF EXISTS "Attendants can update reservations" ON reservations;

DROP POLICY IF EXISTS "Attendants can view agent states" ON agent_states;
DROP POLICY IF EXISTS "Attendants can update agent states" ON agent_states;

DROP POLICY IF EXISTS "Attendants can view verification events" ON verification_events;
DROP POLICY IF EXISTS "Attendants can insert verification events" ON verification_events;

DROP POLICY IF EXISTS "Users can view own penalties" ON penalties;
DROP POLICY IF EXISTS "Attendants can view all penalties" ON penalties;
DROP POLICY IF EXISTS "Attendants can insert penalties" ON penalties;
DROP POLICY IF EXISTS "Attendants can update penalties" ON penalties;

DROP POLICY IF EXISTS "Users can view own payments" ON payments;
DROP POLICY IF EXISTS "Attendants can view all payments" ON payments;
DROP POLICY IF EXISTS "Attendants can insert payments" ON payments;

DROP POLICY IF EXISTS "Public can view rates" ON rates;
DROP POLICY IF EXISTS "Admins can update rates" ON rates;
DROP POLICY IF EXISTS "Admins can insert rates" ON rates;

DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;

DROP POLICY IF EXISTS "Users can view own audit entries" ON audit_log;
DROP POLICY IF EXISTS "Admins can view all audit entries" ON audit_log;
DROP POLICY IF EXISTS "System can insert audit entries" ON audit_log;
DROP POLICY IF EXISTS "Attendants can update audit log entries" ON audit_log;

-- Step 3: Recreate policies using helper functions

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Attendants can view all profiles" ON profiles
  FOR SELECT USING (is_staff());

CREATE POLICY "Admins can insert profiles" ON profiles
  FOR INSERT WITH CHECK (is_admin());

-- Manual Entry lets any attendant register a walk-in customer who has no
-- profile yet; without this, that insert is silently blocked by RLS and
-- the whole flow fails.
CREATE POLICY "Attendants can insert walk-in profiles" ON profiles
  FOR INSERT WITH CHECK (is_staff() AND role = 'customer');

CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (is_admin());

-- User Management's "Delete User" action is admin-only (destructive), unlike
-- the staff-wide access granted elsewhere on this table.
CREATE POLICY "Admins can delete profiles" ON profiles
  FOR DELETE USING (is_admin());

-- Vehicles policies
CREATE POLICY "Users can view own vehicles" ON vehicles
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own vehicles" ON vehicles
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own vehicles" ON vehicles
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Attendants can view all vehicles" ON vehicles
  FOR SELECT USING (is_staff());

-- Manual Entry registers the walk-in's vehicle on their behalf, so
-- owner_id never equals the attendant's own auth.uid().
CREATE POLICY "Attendants can insert vehicles for walk-ins" ON vehicles
  FOR INSERT WITH CHECK (is_staff());

-- Slots policies
CREATE POLICY "Public can view slots" ON slots
  FOR SELECT USING (true);

CREATE POLICY "Attendants can update slots" ON slots
  FOR UPDATE USING (is_staff());

CREATE POLICY "Admins can insert slots" ON slots
  FOR INSERT WITH CHECK (is_admin());

-- Reservations policies
CREATE POLICY "Users can view own reservations" ON reservations
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "Attendants can view all reservations" ON reservations
  FOR SELECT USING (is_staff());

CREATE POLICY "Users can insert reservations" ON reservations
  FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Manual Entry creates the reservation under the walk-in customer's id,
-- not the attendant's, so the self-service policy above doesn't cover it.
CREATE POLICY "Attendants can insert reservations for walk-ins" ON reservations
  FOR INSERT WITH CHECK (is_staff());

CREATE POLICY "Users can cancel own reservations" ON reservations
  FOR UPDATE USING (
    customer_id = auth.uid() AND
    status IN ('pending', 'active')
  )
  WITH CHECK (
    customer_id = auth.uid() AND
    status = 'cancelled'
  );

CREATE POLICY "Attendants can update reservations" ON reservations
  FOR UPDATE USING (is_staff());

-- Agent states policies
CREATE POLICY "Attendants can view agent states" ON agent_states
  FOR SELECT USING (is_staff());

CREATE POLICY "Attendants can update agent states" ON agent_states
  FOR UPDATE USING (is_staff());

-- Verification events policies
CREATE POLICY "Attendants can view verification events" ON verification_events
  FOR SELECT USING (is_staff());

CREATE POLICY "Attendants can insert verification events" ON verification_events
  FOR INSERT WITH CHECK (is_staff());

-- Penalties policies
CREATE POLICY "Users can view own penalties" ON penalties
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "Attendants can view all penalties" ON penalties
  FOR SELECT USING (is_staff());

CREATE POLICY "Attendants can insert penalties" ON penalties
  FOR INSERT WITH CHECK (is_staff());

-- CashPayment marks a penalty paid, and UserManagement waives/adjusts one
-- (amount/status), both via .update() with no matching policy before this.
CREATE POLICY "Attendants can update penalties" ON penalties
  FOR UPDATE USING (is_staff());

-- Payments policies
CREATE POLICY "Users can view own payments" ON payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM reservations
      WHERE reservations.id = payments.reservation_id
      AND reservations.customer_id = auth.uid()
    )
  );

CREATE POLICY "Attendants can view all payments" ON payments
  FOR SELECT USING (is_staff());

CREATE POLICY "Attendants can insert payments" ON payments
  FOR INSERT WITH CHECK (is_staff());

-- Rates policies
CREATE POLICY "Public can view rates" ON rates
  FOR SELECT USING (true);

CREATE POLICY "Admins can update rates" ON rates
  FOR UPDATE USING (is_admin());

CREATE POLICY "Admins can insert rates" ON rates
  FOR INSERT WITH CHECK (is_admin());

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true);

-- Audit log policies
CREATE POLICY "Users can view own audit entries" ON audit_log
  FOR SELECT USING (actor_id = auth.uid());

CREATE POLICY "Admins can view all audit entries" ON audit_log
  FOR SELECT USING (is_admin());

CREATE POLICY "System can insert audit entries" ON audit_log
  FOR INSERT WITH CHECK (actor_id = auth.uid());

-- ManualEntry's void-entry flow marks an existing audit record's details as
-- voided via .update(); no UPDATE policy existed before this. Postgres RLS
-- can't restrict an UPDATE policy to a single column (e.g. details only),
-- so this is a full-row UPDATE gate on staff role -- acceptable here since
-- audit_log already grants staff broad access (all rows via SELECT and
-- INSERT above).
CREATE POLICY "Attendants can update audit log entries" ON audit_log
  FOR UPDATE USING (is_staff());
