-- ParkWise Database Schema
-- Run this in Supabase SQL Editor.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / guarded
-- against "already exists" errors), so applying this again on a database
-- that already has data will NOT drop or wipe anything. This used to be a
-- drop-and-recreate script, which deleted all live data (profiles,
-- reservations, payments, etc.) every time someone re-ran it after a
-- schema tweak -- that's what reset_database.sql is for now (explicit,
-- intentional wipes only). For an actual schema change going forward, add
-- an ALTER TABLE / ALTER TYPE statement below rather than editing a
-- CREATE TABLE/TYPE block, so re-applying this file keeps existing rows.

-- Required extension: btree_gist, for the reservation exclusion constraint
-- below. UUID defaults use the built-in gen_random_uuid() from pg_catalog,
-- so uuid-ossp is no longer needed.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create custom types (guarded: CREATE TYPE has no native IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'attendant', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE slot_status AS ENUM ('available', 'reserved', 'occupied', 'unverified', 'overstay', 'maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('pending', 'active', 'verified', 'completed', 'cancelled', 'no_show', 'overstay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agent_state AS ENUM ('idle', 'waiting', 'verifying', 'verified', 'alert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE verification_result AS ENUM ('match', 'mismatch', 'low_confidence', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE penalty_type AS ENUM ('late_cancel', 'no_show', 'overstay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('unpaid', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('reservation', 'verification', 'payment', 'penalty', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profiles table. Real accounts (customers who sign up, staff created via
-- Account Creation) get id = their auth.users id, set explicitly by the app.
-- Walk-in customers registered via Manual Entry never create a login, so id
-- falls back to an auto-generated UUID with no matching auth.users row --
-- that's why there's no REFERENCES auth.users(id) here (see the ALTER below
-- for upgrading a database that still has the old hard FK).
CREATE TABLE IF NOT EXISTS profiles (
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
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plate_number TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT owner_plate_unique UNIQUE (owner_id, plate_number)
);

-- Slots table
-- floor/zone/zone_row/zone_col describe WHERE a slot sits on the visual
-- parking map (LiveOccupancyDashboard/SlotAssignment), not just that it
-- exists. zone is one of 'compact' (the small row near the entrance),
-- 'block_a' / 'block_b' (the two big double-loaded-aisle blocks, each 10
-- columns wide with a divider after column 5, in a 'top' and a 'bottom'
-- row facing the center aisle), or 'side' (the single column along the
-- far wall). zone_row is only meaningful for block_a/block_b. zone_col is
-- the 1-based position within that zone (and within zone_row, for the
-- blocks) -- it's what the frontend layout template uses to place each
-- slot, not a guarantee of real-world physical measurement.
CREATE TABLE IF NOT EXISTS slots (
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

-- Upgrade path for a database created before floor/zone/zone_row/zone_col
-- existed.
ALTER TABLE slots ADD COLUMN IF NOT EXISTS floor SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS zone TEXT NOT NULL DEFAULT 'block_a';
DO $$ BEGIN
  ALTER TABLE slots ADD CONSTRAINT slots_zone_check CHECK (zone IN ('compact', 'block_a', 'block_b', 'side'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS zone_row TEXT;
DO $$ BEGIN
  ALTER TABLE slots ADD CONSTRAINT slots_zone_row_check CHECK (zone_row IN ('top', 'bottom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS zone_col SMALLINT NOT NULL DEFAULT 1;

-- Reservations table
CREATE TABLE IF NOT EXISTS reservations (
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

-- annotation existed in the TS types but was never added to the live schema
-- (table already existed for anyone who ran the old schema.sql), so add it
-- explicitly for upgrades.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS annotation TEXT;

-- Upgrade path for a database created with the old hard-FK profiles.id:
-- drop the auth.users requirement and give id a default so walk-in profiles
-- (Manual Entry) can be created without ever having a login account.
DO $$ BEGIN
  ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Agent states table (for camera/verification system)
CREATE TABLE IF NOT EXISTS agent_states (
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
CREATE TABLE IF NOT EXISTS verification_events (
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
CREATE TABLE IF NOT EXISTS penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type penalty_type NOT NULL,
  amount NUMERIC NOT NULL,
  status payment_status NOT NULL DEFAULT 'unpaid',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS rates (
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
CREATE TABLE IF NOT EXISTS notifications (
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
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Booking limits cache: a single row holding the two numbers
-- get_booking_limits() computes. Nothing customer-specific lives here, so
-- it is safe to let every signed-in customer read it directly - which is
-- the whole point. A client can never subscribe to live changes on
-- `reservations` from another customer (RLS only lets each customer SELECT
-- their own rows, and Realtime enforces that same RLS on postgres_changes),
-- so a dashboard/reservation screen watching `reservations` directly would
-- only ever "go live" on the signed-in customer's OWN bookings. Triggers
-- below keep this row current on every reservation/slot change, and a
-- public-read table's changes reach every subscriber instantly.
CREATE TABLE IF NOT EXISTS booking_limits_cache (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pwd_max_hours NUMERIC NOT NULL DEFAULT 8,
  regular_max_hours NUMERIC NOT NULL DEFAULT 8,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(slot_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_time ON reservations(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_penalties_customer ON penalties(customer_id);
CREATE INDEX IF NOT EXISTS idx_penalties_status ON penalties(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Enable Row Level Security (idempotent: re-enabling is a no-op)
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

DO $$ BEGIN
  ALTER TABLE slots
    ADD CONSTRAINT slots_current_reservation_fk
    FOREIGN KEY (current_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
