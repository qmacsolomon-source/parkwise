-- ParkWise Database RESET
--
-- WARNING: THIS DELETES ALL DATA.
-- Running this drops every ParkWise table (profiles, vehicles, slots,
-- reservations, payments, penalties, notifications, audit_log, etc.) and
-- recreates them empty. Any existing reservations/customers/history are
-- gone permanently. Supabase Auth users (auth.users) are NOT deleted by
-- this script, but their linked `profiles` rows will be, which is why
-- logins break with "Profile not found" after a reset.
--
-- Only run this for a genuine fresh start (e.g. first-time setup, or
-- deliberately wiping a demo environment). For normal schema changes,
-- edit schema.sql to use IF NOT EXISTS / ALTER TABLE instead of dropping
-- tables, so re-running setup doesn't destroy data.
--
-- After running this, you must re-run (in order): schema.sql is already
-- included below, then rls_policies.sql, business_rules.sql,
-- profile_vehicle_rates_fixes.sql, re-create Auth users + seed.sql, and
-- finally floor_plan_and_assignment.sql (it needs the slots seed.sql
-- creates). See database/RUN_ORDER.md for the full fresh-project order.

-- Enable UUID extensions (id defaults use the built-in gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Safely drop existing tables in correct dependency order
DROP TABLE IF EXISTS booking_limits_cache CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS rates CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS penalties CASCADE;
DROP TABLE IF EXISTS verification_events CASCADE;
DROP TABLE IF EXISTS agent_states CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS slots CASCADE;
DROP TABLE IF EXISTS facility_layout CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Safely drop existing custom types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS slot_status CASCADE;
DROP TYPE IF EXISTS reservation_status CASCADE;
DROP TYPE IF EXISTS agent_state CASCADE;
DROP TYPE IF EXISTS verification_result CASCADE;
DROP TYPE IF EXISTS penalty_type CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;

-- Create custom types
CREATE TYPE user_role AS ENUM ('customer', 'attendant', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE slot_status AS ENUM ('available', 'reserved', 'occupied', 'unverified', 'overstay', 'maintenance');
CREATE TYPE reservation_status AS ENUM ('pending', 'active', 'verified', 'completed', 'cancelled', 'no_show', 'overstay');
CREATE TYPE agent_state AS ENUM ('idle', 'waiting', 'verifying', 'verified', 'alert');
CREATE TYPE verification_result AS ENUM ('match', 'mismatch', 'low_confidence', 'failed');
CREATE TYPE penalty_type AS ENUM ('late_cancel', 'no_show', 'overstay');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid');
CREATE TYPE notification_type AS ENUM ('reservation', 'verification', 'payment', 'penalty', 'system');

-- Profiles table. Real accounts (customers who sign up, staff created via
-- Account Creation) get id = their auth.users id, set explicitly by the app.
-- Walk-in customers registered via Manual Entry never create a login, so id
-- falls back to an auto-generated UUID with no matching auth.users row.
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  status user_status NOT NULL DEFAULT 'active',
  pwd_permit_number TEXT,
  pwd_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicles table
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plate_number TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT owner_plate_unique UNIQUE (owner_id, plate_number)
);

-- Slots table
-- floor/zone/zone_row/zone_col describe WHERE a slot sits on the visual
-- parking map -- see schema.sql for the full explanation.
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_code TEXT NOT NULL UNIQUE,
  is_pwd BOOLEAN NOT NULL DEFAULT FALSE,
  status slot_status NOT NULL DEFAULT 'available',
  current_reservation_id UUID,
  floor SMALLINT NOT NULL DEFAULT 1,
  zone TEXT NOT NULL DEFAULT 'block_a' CHECK (zone IN ('compact', 'block_a', 'block_b', 'side')),
  zone_row TEXT CHECK (zone_row IN ('top', 'bottom')),
  zone_col SMALLINT NOT NULL DEFAULT 1
);

-- Reservations table
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status reservation_status NOT NULL DEFAULT 'pending',
  booking_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cancelled_at TIMESTAMP WITH TIME ZONE,
  annotation TEXT,
  CONSTRAINT no_overlapping_reservations EXCLUDE USING GIST (
    slot_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'completed', 'no_show'))
);

-- Agent states table (for camera/verification system)
CREATE TABLE agent_states (
  slot_id UUID PRIMARY KEY REFERENCES slots(id) ON DELETE CASCADE,
  state agent_state NOT NULL DEFAULT 'idle',
  expected_plate TEXT,
  accepted_at TIMESTAMP WITH TIME ZONE,
  detected_plate TEXT,
  confidence NUMERIC,
  last_frame_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Verification events table
CREATE TABLE verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  detected_plate TEXT NOT NULL,
  expected_plate TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  result verification_result NOT NULL,
  frame_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Penalties table
CREATE TABLE penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type penalty_type NOT NULL,
  amount NUMERIC NOT NULL,
  status payment_status NOT NULL DEFAULT 'unpaid',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  base_charge NUMERIC NOT NULL DEFAULT 0,
  overstay_surcharge NUMERIC NOT NULL DEFAULT 0,
  penalty_total NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  amount_received NUMERIC NOT NULL DEFAULT 0,
  change_given NUMERIC NOT NULL DEFAULT 0,
  attendant_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rates table
CREATE TABLE rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hourly_rate NUMERIC NOT NULL DEFAULT 50,
  overstay_per_hour NUMERIC NOT NULL DEFAULT 100,
  no_show_penalty NUMERIC NOT NULL DEFAULT 100,
  late_cancel_penalty NUMERIC NOT NULL DEFAULT 50,
  late_cancel_window_minutes INTEGER NOT NULL DEFAULT 30,
  grace_period_minutes INTEGER NOT NULL DEFAULT 15,
  updated_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type notification_type NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  related_reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log table
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Booking limits cache table (see schema.sql for why this exists)
CREATE TABLE booking_limits_cache (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pwd_max_hours NUMERIC NOT NULL DEFAULT 8,
  regular_max_hours NUMERIC NOT NULL DEFAULT 8,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_vehicles_owner ON vehicles(owner_id);
CREATE INDEX idx_reservations_customer ON reservations(customer_id);
CREATE INDEX idx_reservations_slot ON reservations(slot_id);
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_time ON reservations(start_time, end_time);
CREATE INDEX idx_penalties_customer ON penalties(customer_id);
CREATE INDEX idx_penalties_status ON penalties(status);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_limits_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE slots
  ADD CONSTRAINT slots_current_reservation_fk
  FOREIGN KEY (current_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;
