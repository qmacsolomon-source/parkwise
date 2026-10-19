import type { SlotFacing } from './floorPlan';

export type UserRole = 'customer' | 'attendant' | 'admin';
export type UserStatus = 'active' | 'disabled';
export type SlotStatus = 'available' | 'reserved' | 'occupied' | 'unverified' | 'overstay' | 'maintenance';
export type ReservationStatus = 'pending' | 'active' | 'verified' | 'completed' | 'cancelled' | 'no_show' | 'overstay';
export type AgentStateValue = 'idle' | 'waiting' | 'verifying' | 'verified' | 'alert';
export type VerificationResult = 'match' | 'mismatch' | 'low_confidence' | 'failed';
export type PenaltyType = 'late_cancel' | 'no_show' | 'overstay';
export type PaymentStatus = 'unpaid' | 'paid';
export type NotificationType = 'reservation' | 'verification' | 'payment' | 'penalty' | 'system';
// The LIVE database only uses two zones: 'block_a' (60 bays per floor, a
// double-loaded row) and 'side' (9 bays per floor, against the far wall).
// 'compact' and 'block_b' belonged to the older 102-slot layout and are not
// present in the live data.
export type SlotZone = 'block_a' | 'side';
export type SlotZoneRow = 'top' | 'bottom';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  pwd_permit_number: string | null;
  pwd_verified: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  owner_id: string;
  plate_number: string;
  vehicle_type: string;
  is_default: boolean;
  /** FALSE once the owner removes a vehicle that has booking history. */
  is_active?: boolean;
}

export interface Slot {
  id: string;
  slot_code: string;
  is_pwd: boolean;
  status: SlotStatus;
  current_reservation_id: string | null;
  // Where this slot sits on the visual parking map, not a precise
  // real-world measurement -- see database/schema.sql for the full
  // explanation of what each zone/row looks like.
  floor: number;
  zone: SlotZone;
  zone_row: SlotZoneRow | null;
  zone_col: number;
  // Geometry on the 1920x1080 plan canvas. All NULL until
  // database/live_upgrade/03_floor_plan_207.sql has been run; that file only
  // fills these columns in, it never rewrites a slot.
  floor_x?: number | null;
  floor_y?: number | null;
  floor_w?: number | null;
  floor_h?: number | null;
  facing?: SlotFacing | null;
  entry_rank?: number | null;
}

export interface Reservation {
  id: string;
  customer_id: string;
  vehicle_id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  booking_code: string;
  created_at: string;
  cancelled_at: string | null;
  annotation: string | null;
}

export interface AgentState {
  slot_id: string;
  state: AgentStateValue;
  expected_plate: string | null;
  accepted_at: string | null;
  detected_plate: string | null;
  confidence: number | null;
  last_frame_url: string | null;
  updated_at: string;
}

export interface VerificationEvent {
  id: string;
  slot_id: string;
  reservation_id: string;
  detected_plate: string;
  expected_plate: string;
  confidence: number;
  result: VerificationResult;
  frame_url: string | null;
  created_at: string;
}

export interface Penalty {
  id: string;
  customer_id: string;
  reservation_id: string;
  type: PenaltyType;
  amount: number;
  status: PaymentStatus;
  created_at: string;
}

export interface Payment {
  id: string;
  reservation_id: string;
  base_charge: number;
  overstay_surcharge: number;
  penalty_total: number;
  total: number;
  amount_received: number;
  change_given: number;
  attendant_id: string;
  paid_at: string;
}

export interface Rate {
  id: string;
  hourly_rate: number;
  overstay_per_hour: number;
  no_show_penalty: number;
  late_cancel_penalty: number;
  late_cancel_window_minutes: number;
  grace_period_minutes: number;
  /** Null until an admin edits the rates (see seed.sql / rates fixes). */
  updated_by: string | null;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  is_read: boolean;
  related_reservation_id: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  action: string;
  details: any;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: any; Update: any };
      vehicles: { Row: Vehicle; Insert: any; Update: any };
      slots: { Row: Slot; Insert: any; Update: any };
      reservations: { Row: Reservation; Insert: any; Update: any };
      agent_states: { Row: AgentState; Insert: any; Update: any };
      verification_events: { Row: VerificationEvent; Insert: any; Update: any };
      penalties: { Row: Penalty; Insert: any; Update: any };
      payments: { Row: Payment; Insert: any; Update: any };
      rates: { Row: Rate; Insert: any; Update: any };
      notifications: { Row: Notification; Insert: any; Update: any };
      audit_log: { Row: AuditLog; Insert: any; Update: any };
    };
  };
}
