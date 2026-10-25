// Booking data layer for the phone.
//
// Everything that talks to assign_slot_for_reservation /
// change_reservation_slot / get_floor_plan lives here so the screens stay
// presentational. The server owns the assignment policy (entry_rank, PWD
// priority, penalty block, concurrency) -- the phone only validates what it
// can validate locally for a fast, friendly message, and still surfaces the
// server's own error code if it disagrees.

import { Rate, supabase } from '@parkwise/shared';

/** Mirrors MAX_DURATION_HOURS in database/live_upgrade/03_floor_plan_207.sql. */
export const MAX_DURATION_HOURS = 24;
export const MIN_DURATION_MINUTES = 30;
/** Mirrors PAST_TOLERANCE_MINUTES in the same file. */
export const PAST_TOLERANCE_MINUTES = 5;

export type BookingErrorCode =
  | 'AUTH_REQUIRED'
  | 'VEHICLE_NOT_FOUND'
  | 'NOT_YOUR_VEHICLE'
  | 'INVALID_WINDOW'
  | 'PAST_START'
  | 'TOO_LONG'
  | 'UNPAID_PENALTIES'
  | 'NO_SLOT_AVAILABLE'
  | 'SLOT_TAKEN'
  | 'NOT_ALLOWED'
  | 'PWD_ONLY'
  | 'BOOKING_TOO_FAR_AHEAD'
  | 'UNKNOWN';

const MESSAGES: Record<BookingErrorCode, string> = {
  AUTH_REQUIRED: 'Please sign in again to book a slot.',
  VEHICLE_NOT_FOUND: 'That vehicle is no longer registered to your account.',
  NOT_YOUR_VEHICLE: 'That vehicle does not belong to your account.',
  INVALID_WINDOW: 'Check the times: the end must be after the start.',
  PAST_START: 'That start time is already in the past. Pick a later time.',
  TOO_LONG: `A single booking can be at most ${MAX_DURATION_HOURS} hours.`,
  UNPAID_PENALTIES:
    'You have an unpaid penalty. Please settle it at the attendant counter before booking a new slot.',
  NO_SLOT_AVAILABLE: 'Every bay is taken for that time. Try a different time and we will look again.',
  SLOT_TAKEN: 'Someone just took that bay. The plan has been refreshed with the latest availability.',
  NOT_ALLOWED: 'That booking can no longer be changed.',
  PWD_ONLY: 'That is a PWD bay, and your account is not PWD-verified.',
  BOOKING_TOO_FAR_AHEAD:
    "The lot is getting full, so advance booking is limited right now. Check the notice on your dashboard for how far ahead you can currently book.",
  UNKNOWN: 'Something went wrong. Please try again.',
};

/** Error code raised by the SQL functions, carried as `BookingError.code`. */
export class BookingError extends Error {
  readonly code: BookingErrorCode;

  constructor(code: BookingErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'BookingError';
    this.code = code;
  }
}

const KNOWN_CODES = Object.keys(MESSAGES) as BookingErrorCode[];

/** Turn a PostgREST/plpgsql error into a BookingError we can switch on. */
export function toBookingError(error: unknown): BookingError {
  const raw = String((error as { message?: string } | null)?.message ?? error ?? '');
  const code = KNOWN_CODES.find((candidate) => candidate !== 'UNKNOWN' && raw.includes(candidate));
  if (code) return new BookingError(code);
  return new BookingError('UNKNOWN', raw || undefined);
}

function requireClient() {
  if (!supabase) throw new BookingError('UNKNOWN', 'Supabase is not configured in this build.');
  return supabase;
}

export interface AssignSlotResult {
  reservation_id: string;
  booking_code: string;
  slot_id: string;
  slot_code: string;
  floor: number;
  start_time: string;
  end_time: string;
  estimated_charge: number;
}

export interface ChangeSlotResult {
  reservation_id: string;
  booking_code: string;
  slot_id: string;
  slot_code: string;
  floor: number;
  start_time: string;
  end_time: string;
}

/** Ask the server for the best free bay in this window. */
export async function assignSlotForReservation(
  vehicleId: string,
  start: string,
  end: string
): Promise<AssignSlotResult> {
  const { data, error } = await requireClient().rpc('assign_slot_for_reservation', {
    p_vehicle_id: vehicleId,
    p_start: start,
    p_end: end,
  });

  if (error) throw toBookingError(error);
  return data as AssignSlotResult;
}

/** Move an existing booking onto a bay the customer chose on the plan. */
export async function changeReservationSlot(
  reservationId: string,
  newSlotId: string
): Promise<ChangeSlotResult> {
  const { data, error } = await requireClient().rpc('change_reservation_slot', {
    p_reservation_id: reservationId,
    p_new_slot_id: newSlotId,
  });

  if (error) throw toBookingError(error);
  return data as ChangeSlotResult;
}

export interface RateLookup {
  /** Newest rate row, or null when there is none. */
  rate: Rate | null;
  /** Set only when the table itself could not be read (permissions, missing table). */
  error: string | null;
}

/**
 * Newest rate row, used for the estimate. Never throws. `error` is only set
 * when the request failed, so the caller can tell "could not read the table"
 * apart from "no rate has been configured yet" and say which one it is.
 */
export async function fetchLatestRate(): Promise<RateLookup> {
  if (!supabase) {
    return { rate: null, error: 'Supabase is not configured in this build.' };
  }

  const { data, error } = await supabase
    .from('rates')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { rate: null, error: error.message };
  return { rate: (data as Rate) ?? null, error: null };
}

export interface BookingLimits {
  pwdMaxHours: number;
  regularMaxHours: number;
}

/** Default when booking_limits_cache can't be reached - matches MAX_ADVANCE_HOURS in the SQL function, so an unreachable server fails open to "no extra restriction" rather than silently blocking every booking. */
export const DEFAULT_BOOKING_LIMITS: BookingLimits = { pwdMaxHours: 8, regularMaxHours: 8 };

/**
 * How far ahead a new booking is currently allowed to reach - shrinks as the
 * lot fills up. Reads the single-row booking_limits_cache table (see
 * database/live_upgrade/18_booking_limits_cache.sql) rather than calling
 * get_booking_limits() directly: RLS only lets a customer SELECT their own
 * reservations, and Realtime enforces that same RLS on postgres_changes, so
 * a client-side subscription to `reservations` would never see another
 * customer's booking. booking_limits_cache is public-read and kept current
 * by triggers on reservations/slots, so subscribing to IT (see the two
 * screens that call this) actually reaches every customer live. Never
 * throws, same reasoning as fetchLatestRate: this drives a notice banner and
 * a date-picker clamp, not a hard gate by itself - the server's own check in
 * assign_slot_for_reservation is the real enforcement.
 */
export async function getBookingLimits(): Promise<BookingLimits> {
  if (!supabase) return DEFAULT_BOOKING_LIMITS;

  const { data, error } = await supabase
    .from('booking_limits_cache')
    .select('pwd_max_hours, regular_max_hours')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return DEFAULT_BOOKING_LIMITS;

  const row = data as { pwd_max_hours: number; regular_max_hours: number };
  return {
    pwdMaxHours: Number(row.pwd_max_hours),
    regularMaxHours: Number(row.regular_max_hours),
  };
}

/** The limit that actually applies to this customer - the more generous of
 * the two pools when they're PWD-verified (they can already fall back to a
 * regular bay), otherwise just the regular pool's limit. */
export function effectiveMaxAdvanceHours(limits: BookingLimits, pwdVerified: boolean): number {
  return pwdVerified ? Math.max(limits.pwdMaxHours, limits.regularMaxHours) : limits.regularMaxHours;
}

/** "3 hr 30 min" / "45 min" / "now only" - same rounding (nearest 15 min)
 * for the dashboard notice and the reservation screen's own copy of it. */
export function formatAdvanceLimit(hours: number): string {
  if (hours <= 0) return 'now only';
  const rounded = Math.round(hours * 4) / 4;
  if (rounded <= 0) return 'now only';
  const whole = Math.floor(rounded);
  const minutes = Math.round((rounded - whole) * 60);
  if (whole && minutes) return `${whole} hr ${minutes} min`;
  if (whole) return `${whole} hour${whole === 1 ? '' : 's'}`;
  return `${minutes} min`;
}

export function hoursBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
}

/** Same rounding the server uses: whole hours, rounded up. */
export function estimateCharge(start: string, end: string, hourlyRate: number | null): number {
  if (!hourlyRate) return 0;
  return Math.ceil(Math.max(hoursBetween(start, end), 0)) * hourlyRate;
}

/**
 * Local pre-flight check. Returns a message to show under the time fields, or
 * null when the window looks fine. The server re-checks everything.
 *
 * maxAdvanceHours is optional (defaults to no extra restriction) so existing
 * callers that don't pass it behave exactly as before - it's meant to be the
 * result of effectiveMaxAdvanceHours(), checked here as a fast, local
 * mirror of assign_slot_for_reservation's own BOOKING_TOO_FAR_AHEAD check.
 */
export function validateWindow(
  start: string,
  end: string,
  now: Date = new Date(),
  maxAdvanceHours: number = Infinity
): string | null {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();

  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Pick a start and an end time.';
  if (to <= from) return MESSAGES.INVALID_WINDOW;
  if (to - from < MIN_DURATION_MINUTES * 60_000) {
    return `A booking needs to be at least ${MIN_DURATION_MINUTES} minutes long.`;
  }
  if (to - from > MAX_DURATION_HOURS * 3_600_000) return MESSAGES.TOO_LONG;
  if (from < now.getTime() - PAST_TOLERANCE_MINUTES * 60_000) return MESSAGES.PAST_START;
  if (from > now.getTime() + maxAdvanceHours * 3_600_000) return MESSAGES.BOOKING_TOO_FAR_AHEAD;

  return null;
}

export interface WindowSuggestion {
  start: string;
  end: string;
  freeCount: number;
}

/**
 * Cheap "when is something free?" probe for the NO_SLOT_AVAILABLE state: try
 * a handful of nearby windows and keep the ones where get_floor_plan() still
 * reports at least one available bay.
 */
export async function suggestNearbyWindows(
  start: string,
  end: string,
  attempts = 6
): Promise<WindowSuggestion[]> {
  if (!supabase) return [];

  const duration = new Date(end).getTime() - new Date(start).getTime();
  const offsets = [30, -30, 60, -60, 120, 180].slice(0, attempts);
  const suggestions: WindowSuggestion[] = [];

  for (const offset of offsets) {
    const from = new Date(new Date(start).getTime() + offset * 60_000);
    if (from.getTime() < Date.now()) continue;
    const to = new Date(from.getTime() + duration);

    const { data, error } = await supabase.rpc('get_floor_plan', {
      p_start: from.toISOString(),
      p_end: to.toISOString(),
    });

    if (error || !Array.isArray(data)) continue;

    const freeCount = (data as { availability?: string }[]).filter(
      (row) => row.availability === 'available'
    ).length;

    if (freeCount > 0) {
      suggestions.push({ start: from.toISOString(), end: to.toISOString(), freeCount });
      if (suggestions.length >= 2) break;
    }
  }

  return suggestions;
}

// --- display helpers -------------------------------------------------------

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * Displayed in the phone's own time zone; the server always receives
 * toISOString() (UTC) so the Philippine offset is handled in one place.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, DATE_FORMAT);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, TIME_FORMAT);
}

export function formatWindow(start: string, end: string): string {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  if (sameDay) return `${formatDate(start)}, ${formatTime(start)} – ${formatTime(end)}`;
  return `${formatDate(start)} ${formatTime(start)} – ${formatDate(end)} ${formatTime(end)}`;
}

export function formatDuration(start: string, end: string): string {
  const minutes = Math.max(Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000), 0);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  if (hours) return `${hours} hr`;
  return `${rest} min`;
}
