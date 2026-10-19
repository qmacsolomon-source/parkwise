import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@parkwise/shared';
import {
  DEFAULT_AISLE,
  FloorPlanAvailabilityValue,
  FloorPlanLayout,
  FloorPlanSlot,
  IMAGE_H,
  IMAGE_W,
  Slot,
  buildSchematicGeometry,
  schematicKey,
} from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';

export type FloorPlanSource = 'database' | 'local';

export interface UseFloorPlanOptions {
  /** Inclusive start of the window being asked about (ISO string). */
  start: string | null;
  /** Exclusive end of the window being asked about (ISO string). */
  end: string | null;
  /** Skip fetching entirely (e.g. no window chosen yet). */
  enabled?: boolean;
  /** Poll/subscribe for changes. Defaults to true. */
  realtime?: boolean;
}

export interface UseFloorPlanResult {
  slots: FloorPlanSlot[];
  layout: FloorPlanLayout;
  loading: boolean;
  error: string | null;
  /**
   * 'database' once database/live_upgrade/03_floor_plan_207.sql has been run
   * and get_floor_plan() answers; 'local' when the app is drawing the same
   * plan from the shared layout constants because that upgrade is not there yet.
   */
  source: FloorPlanSource;
  refresh: () => Promise<void>;
}

const LOCAL_LAYOUT: FloorPlanLayout = {
  canvas_width: IMAGE_W,
  canvas_height: IMAGE_H,
  entrance_x: DEFAULT_AISLE.entrance.x,
  entrance_y: DEFAULT_AISLE.entrance.y,
  aisle: DEFAULT_AISLE,
};

const OPEN_RESERVATION_STATUSES = ['pending', 'active'];

/**
 * The shared client is typed as nullable because the desktop build allows an
 * unconfigured environment. On the phone it is always created (supabase.native
 * throws when the EXPO_PUBLIC_* variables are missing), so this narrows once.
 */
function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured in this build.');
  return supabase;
}

/**
 * Loads the floor plan for a time window.
 *
 * Preferred path is the get_floor_plan(start, end) database function, which
 * decides availability server-side so the phone never sees another customer's
 * reservation. If that function is not installed yet (see
 * database/live_upgrade/03_floor_plan_207.sql) the hook degrades to the
 * same information computed from the `slots` and `reservations` tables plus
 * shared/src/floorLayout.ts, so the plan still renders correctly.
 */
export function useFloorPlan({ start, end, enabled = true, realtime = true }: UseFloorPlanOptions): UseFloorPlanResult {
  const { user, profile } = useAuth();
  const pwdVerified = !!profile?.pwd_verified;

  const [slots, setSlots] = useState<FloorPlanSlot[]>([]);
  const [layout, setLayout] = useState<FloorPlanLayout>(LOCAL_LAYOUT);
  const [loading, setLoading] = useState(enabled && !!start && !!end);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<FloorPlanSource>('local');

  // Guards against out-of-order responses when the window changes quickly.
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchLayout = useCallback(async (): Promise<FloorPlanLayout> => {
    try {
      const { data, error: layoutError } = await requireClient()
        .from('facility_layout')
        .select('canvas_width, canvas_height, entrance_x, entrance_y, aisle')
        .eq('id', 1)
        .maybeSingle();

      if (layoutError || !data) return LOCAL_LAYOUT;

      return {
        canvas_width: Number(data.canvas_width) || IMAGE_W,
        canvas_height: Number(data.canvas_height) || IMAGE_H,
        entrance_x: Number(data.entrance_x) || DEFAULT_AISLE.entrance.x,
        entrance_y: Number(data.entrance_y) || DEFAULT_AISLE.entrance.y,
        aisle: (data.aisle as FloorPlanLayout['aisle']) ?? DEFAULT_AISLE,
      };
    } catch {
      return LOCAL_LAYOUT;
    }
  }, []);

  const fetchFromFunction = useCallback(
    async (from: string, to: string): Promise<FloorPlanSlot[] | null> => {
      const { data, error: rpcError } = await requireClient().rpc('get_floor_plan', {
        p_start: from,
        p_end: to,
      });

      // 42883 = undefined_function, PGRST202 = function not found in schema cache.
      if (rpcError) return null;
      if (!Array.isArray(data)) return null;

      return (data as any[]).map((row) => ({
        slot_id: String(row.slot_id),
        slot_code: String(row.slot_code),
        is_pwd: !!row.is_pwd,
        floor: Number(row.floor),
        zone: String(row.zone),
        zone_row: row.zone_row ?? null,
        zone_col: Number(row.zone_col),
        floor_x: row.floor_x === null ? null : Number(row.floor_x),
        floor_y: row.floor_y === null ? null : Number(row.floor_y),
        floor_w: row.floor_w === null ? null : Number(row.floor_w),
        floor_h: row.floor_h === null ? null : Number(row.floor_h),
        facing: row.facing ?? null,
        entry_rank: row.entry_rank === null ? null : Number(row.entry_rank),
        availability: String(row.availability) as FloorPlanAvailabilityValue,
      }));
    },
    []
  );

  const fetchLocally = useCallback(
    async (from: string, to: string): Promise<FloorPlanSlot[]> => {
      const [slotsResult, reservationsResult] = await Promise.all([
        requireClient()
          .from('slots')
          .select('id, slot_code, is_pwd, status, floor, zone, zone_row, zone_col')
          .order('floor')
          .order('zone')
          .order('zone_col'),
        requireClient()
          .from('reservations')
          .select('slot_id, customer_id')
          .in('status', OPEN_RESERVATION_STATUSES)
          .lt('start_time', to)
          .gt('end_time', from),
      ]);

      if (slotsResult.error) throw slotsResult.error;

      const takenBy = new Map<string, string>();
      for (const reservation of reservationsResult.data ?? []) {
        takenBy.set(reservation.slot_id as string, reservation.customer_id as string);
      }

      const rows: FloorPlanSlot[] = [];
      const slotRows = (slotsResult.data ?? []) as unknown as Slot[];
      const geoMap = buildSchematicGeometry(slotRows);
      for (const slot of slotRows) {
        const geometry = geoMap.get(
          schematicKey(slot.floor, slot.zone, slot.zone_row, slot.zone_col)
        );
        const holder = takenBy.get(slot.id);

        let availability: FloorPlanAvailabilityValue = 'available';
        if (slot.status === 'maintenance') availability = 'maintenance';
        else if (slot.is_pwd && !pwdVerified) availability = 'pwd_locked';
        else if (holder && user && holder === user.id) availability = 'mine';
        else if (holder) availability = 'reserved';

        rows.push({
          slot_id: slot.id,
          slot_code: slot.slot_code,
          is_pwd: slot.is_pwd,
          floor: slot.floor,
          zone: slot.zone,
          zone_row: slot.zone_row,
          zone_col: slot.zone_col,
          floor_x: geometry?.floor_x ?? null,
          floor_y: geometry?.floor_y ?? null,
          floor_w: geometry?.floor_w ?? null,
          floor_h: geometry?.floor_h ?? null,
          facing: geometry?.facing ?? null,
          entry_rank: null,
          availability,
        });
      }

      // entry_rank is only computed in SQL; approximate it locally so the
      // "closest to the entrance" line still reads sensibly per floor.
      const entrance = LOCAL_LAYOUT.aisle?.entrance ?? DEFAULT_AISLE.entrance;
      const byFloor = new Map<number, FloorPlanSlot[]>();
      for (const row of rows) {
        const bucket = byFloor.get(row.floor) ?? [];
        bucket.push(row);
        byFloor.set(row.floor, bucket);
      }
      for (const bucket of byFloor.values()) {
        bucket
          .slice()
          .sort((a, b) => {
            const distance = (s: FloorPlanSlot) =>
              Math.hypot(
                (s.floor_x ?? 0) + (s.floor_w ?? 0) / 2 - entrance.x,
                (s.floor_y ?? 0) + (s.floor_h ?? 0) / 2 - entrance.y
              );
            return distance(a) - distance(b) || a.slot_code.localeCompare(b.slot_code);
          })
          .forEach((slot, index) => {
            slot.entry_rank = index + 1;
          });
      }

      return rows;
    },
    [pwdVerified, user]
  );

  const refresh = useCallback(async () => {
    if (!enabled || !start || !end) {
      setSlots([]);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const nextLayout = await fetchLayout();
      const fromFunction = await fetchFromFunction(start, end);

      let nextSlots: FloorPlanSlot[];
      let nextSource: FloorPlanSource;
      if (fromFunction) {
        nextSlots = fromFunction;
        nextSource = 'database';
      } else {
        nextSlots = await fetchLocally(start, end);
        nextSource = 'local';
      }

      if (!mounted.current || id !== requestId.current) return;

      const withGeometry = nextSlots.filter(
        (slot) => slot.floor_x !== null && slot.floor_y !== null && slot.floor_w !== null && slot.floor_h !== null
      );
      // Locally computed geometry can be filled in for rows the database left empty.
      const localGeo = buildSchematicGeometry(nextSlots);
      const merged = nextSlots.map((slot) => {
        if (slot.floor_x !== null) return slot;
        const geometry = localGeo.get(
          schematicKey(slot.floor, slot.zone, slot.zone_row, slot.zone_col)
        );
        if (!geometry) return slot;
        return { ...slot, ...geometry };
      });

      setLayout(nextLayout);
      setSlots(merged);
      setSource(withGeometry.length > 0 ? nextSource : 'local');
    } catch (fetchError) {
      if (!mounted.current || id !== requestId.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load the floor plan.');
      setSlots([]);
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [enabled, start, end, fetchLayout, fetchFromFunction, fetchLocally]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates: occupancy changes must show up without pulling to refresh.
  useEffect(() => {
    if (!realtime || !enabled || !supabase) return;

    const client = supabase;
    const channel = client
      .channel('floor-plan-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => refresh())
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [realtime, enabled, refresh]);

  const sortedSlots = useMemo(
    () => slots.slice().sort((a, b) => a.floor - b.floor || a.slot_code.localeCompare(b.slot_code)),
    [slots]
  );

  return { slots: sortedSlots, layout, loading, error, source, refresh };
}
