-- ParkWise: per-slot gate (servo) commands.
-- Customer taps "Open gate" on mobile -> row inserted here -> ESP32-CAM polls,
-- relays over UART to the servo Arduino, then PATCHes status to 'acked'.

CREATE TABLE IF NOT EXISTS gate_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  slot_code TEXT NOT NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('open', 'close')),
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending', 'acked', 'failed', 'expired')),
  requested_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gate_commands_pending_idx
  ON gate_commands (slot_code) WHERE status = 'pending';

ALTER TABLE gate_commands ENABLE ROW LEVEL SECURITY;

-- Customer may INSERT an 'open'/'close' only for a slot on their own active
-- reservation; the check keeps a demo from opening someone else's gate.
DROP POLICY IF EXISTS gate_commands_insert_own ON gate_commands;
CREATE POLICY gate_commands_insert_own ON gate_commands
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.slot_id = gate_commands.slot_id
        AND r.customer_id = auth.uid()
        AND r.status IN ('active', 'verified')
    )
  );

-- Customer sees only their own commands (drives the mobile state display).
DROP POLICY IF EXISTS gate_commands_select_own ON gate_commands;
CREATE POLICY gate_commands_select_own ON gate_commands
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid());

-- The device needs to read pending rows and ack them. For the demo, the
-- simplest path is a dedicated device role/service key. If you must use the
-- anon key on the ESP32, add a narrow policy instead:
DROP POLICY IF EXISTS gate_commands_device_rw ON gate_commands;
CREATE POLICY gate_commands_device_rw ON gate_commands
  FOR ALL TO anon
  USING (status = 'pending')
  WITH CHECK (status IN ('pending', 'acked', 'failed'));

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE gate_commands;
