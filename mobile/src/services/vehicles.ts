// Vehicle data layer for the phone.
//
// The plate rules live in @parkwise/shared; this file owns the vehicle CRUD
// so the Reserve empty state, the My vehicles screen and the registration
// form all agree.

import { Vehicle, normalizePlate, supabase } from '@parkwise/shared';

// The plate rules live in @parkwise/shared so the mobile form, the Reserve
// screen and the sign-up metadata path all agree. Re-exported here so the
// existing '../services/vehicles' imports keep working.
export { isValidPlate, normalizePlate, plateError } from '@parkwise/shared';

export interface VehicleTypeOption {
  value: string;
  label: string;
}

/**
 * Four-wheeled body types only -- motorcycles and tricycles are out of scope
 * for ParkWise, and the shared plate rule below is the 4-wheeler format.
 */
export const VEHICLE_TYPES: VehicleTypeOption[] = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'hatchback', label: 'Hatchback' },
];

export const DEFAULT_VEHICLE_TYPE = VEHICLE_TYPES[0].value;

/** Statuses that still occupy a bay. */
const OPEN_STATUSES = ['pending', 'active', 'verified'];

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured in this build.');
  return supabase;
}

/** Turns a PostgREST error into something safe to show a customer. */
export function vehicleErrorMessage(error: unknown): string {
  const details = error as { code?: string; message?: string } | null;
  if (details?.code === '23505') return 'That plate number is already registered.';
  if (details?.code === '23503') return 'That vehicle is still linked to a booking.';
  // 23514 = check_violation. Postgres re-checks vehicles_plate_format_check
  // against the WHOLE row on any UPDATE, not just when plate_number itself
  // changes - a vehicle with a stale, no-longer-valid plate format can trip
  // this on an otherwise unrelated update (e.g. setDefaultVehicle()'s
  // owner-wide is_default clear). Without this mapping the raw constraint
  // name/SQL text surfaced directly to the customer.
  if (details?.code === '23514') {
    return 'That plate number is not in a valid format (3 letters followed by 3 or 4 numbers, e.g. ABC1234).';
  }
  return details?.message || 'Something went wrong. Please try again.';
}

export async function listVehicles(ownerId: string): Promise<Vehicle[]> {
  const { data, error } = await requireClient()
    .from('vehicles')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('is_active', true)
    .order('is_default', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Vehicle[];
}

/** Makes `vehicleId` the only default vehicle for the owner. */
export async function setDefaultVehicle(ownerId: string, vehicleId: string): Promise<void> {
  const client = requireClient();

  const { error: clearError } = await client
    .from('vehicles')
    .update({ is_default: false })
    .eq('owner_id', ownerId);
  if (clearError) throw clearError;

  const { error } = await client
    .from('vehicles')
    .update({ is_default: true })
    .eq('id', vehicleId)
    .eq('owner_id', ownerId);
  if (error) throw error;
}

export interface VehicleInput {
  ownerId: string;
  plateNumber: string;
  vehicleType: string;
  /** Ignored for the owner's very first vehicle, which is always the default. */
  makeDefault?: boolean;
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const client = requireClient();
  const existing = await listVehicles(input.ownerId);
  const makeDefault = !!input.makeDefault || existing.length === 0;

  const { data, error } = await client
    .from('vehicles')
    .insert({
      owner_id: input.ownerId,
      plate_number: normalizePlate(input.plateNumber),
      vehicle_type: input.vehicleType,
      is_default: makeDefault,
    })
    .select()
    .single();

  if (error) throw error;

  const vehicle = data as Vehicle;
  if (makeDefault) await setDefaultVehicle(input.ownerId, vehicle.id);
  return vehicle;
}

export async function updateVehicle(
  vehicleId: string,
  updates: { plateNumber?: string; vehicleType?: string }
): Promise<Vehicle> {
  // Only the plate matters here, not vehicle_type: the camera agent's
  // expected_plate (agent-service's accept_vehicle()) and an attendant's own
  // eyes both compare against whatever plate was on the vehicle at accept
  // time. deleteVehicle() already refuses to touch a vehicle with an active
  // reservation (hasActiveReservation() below) - editing its plate out from
  // under an in-progress verification is the same risk and had no guard at
  // all.
  if (updates.plateNumber !== undefined && (await hasActiveReservation(vehicleId))) {
    throw new Error(
      'This vehicle has an active reservation. Cancel or complete the booking before changing its plate number.'
    );
  }

  const patch: Record<string, string> = {};
  if (updates.plateNumber !== undefined) patch.plate_number = normalizePlate(updates.plateNumber);
  if (updates.vehicleType !== undefined) patch.vehicle_type = updates.vehicleType;

  const { data, error } = await requireClient()
    .from('vehicles')
    .update(patch)
    .eq('id', vehicleId)
    .select()
    .single();

  if (error) throw error;
  return data as Vehicle;
}

/** True while the vehicle is attached to a booking that still occupies a bay. */
export async function hasActiveReservation(vehicleId: string): Promise<boolean> {
  // 'overstay' means end_time has already passed by definition, so it
  // can't share the end_time > now check the other open statuses need -
  // without this split, a vehicle that's still physically parked past its
  // booking read as having no active reservation, letting deleteVehicle()
  // archive it while it was still in the lot.
  const client = requireClient();
  const nowIso = new Date().toISOString();

  const [openResult, overstayResult] = await Promise.all([
    client
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .in('status', OPEN_STATUSES)
      .gt('end_time', nowIso),
    client
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .eq('status', 'overstay'),
  ]);

  if (openResult.error) throw openResult.error;
  if (overstayResult.error) throw overstayResult.error;

  return (openResult.count ?? 0) > 0 || (overstayResult.count ?? 0) > 0;
}

/** True when the vehicle has ever been used (any status, past or present). */
export async function hasAnyReservation(vehicleId: string): Promise<boolean> {
  const { count, error } = await requireClient()
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** What actually happened, so the UI can say the right thing. */
export type DeleteVehicleResult = 'deleted' | 'archived';

/**
 * Removes a vehicle. A vehicle that was ever booked is only archived
 * (`is_active = false`): reservations -- and the payments and penalties that
 * cascade off them -- hang off the vehicle, so a real DELETE would destroy
 * that history. Only a vehicle with no booking history at all is deleted for
 * real, which also frees its plate number.
 */
export async function deleteVehicle(vehicleId: string): Promise<DeleteVehicleResult> {
  if (await hasActiveReservation(vehicleId)) {
    throw new Error(
      'This vehicle has an active reservation. Cancel the booking before deleting the vehicle.'
    );
  }

  if (await hasAnyReservation(vehicleId)) {
    const { error } = await requireClient()
      .from('vehicles')
      .update({ is_active: false, is_default: false })
      .eq('id', vehicleId);
    if (error) throw error;
    return 'archived';
  }

  const { error } = await requireClient().from('vehicles').delete().eq('id', vehicleId);
  if (error) throw error;
  return 'deleted';
}
