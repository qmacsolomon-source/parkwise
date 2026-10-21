import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';
import { useFloorPlan } from '../hooks/useFloorPlan';
import AppScreen from '../components/AppScreen';
import FloorPlan from '../components/FloorPlan';
import { EmptyState, ScreenHeader, SkeletonList } from '../components/ui';
import { spacing } from '../theme/tokens';

export type WayfindingParams = {
  reservationId?: string;
  slotId?: string;
  slotCode?: string;
  start?: string;
  end?: string;
};

interface ActiveBooking {
  id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
}

/**
 * "Show me the way": the floor plan with the driving route to the booked bay,
 * the pulsing YOU marker and the written directions. Reached from Home and
 * from the Timer.
 */
export default function WayfindingScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ Wayfinding: WayfindingParams }, 'Wayfinding'>>();
  const params = route.params ?? {};
  const { profile } = useAuth();

  const [booking, setBooking] = useState<ActiveBooking | null>(null);
  const [loading, setLoading] = useState(!params.start || !params.end);

  // Only needed when the caller did not hand us a window (e.g. deep link).
  const loadActiveBooking = useCallback(async () => {
    if (!supabase || !profile?.id) return;

    const { data, error } = await supabase
      .from('reservations')
      .select('id, slot_id, start_time, end_time')
      .eq('customer_id', profile.id)
      .in('status', ['pending', 'active'])
      .order('start_time', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[wayfinding] could not load the active booking:', error.message);
      return;
    }

    setBooking((data as ActiveBooking) ?? null);
  }, [profile?.id]);

  useEffect(() => {
    if (params.start && params.end) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadActiveBooking().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [params.start, params.end, loadActiveBooking]);

  const start = params.start ?? booking?.start_time ?? null;
  const end = params.end ?? booking?.end_time ?? null;
  const slotId = params.slotId ?? booking?.slot_id ?? null;

  const { slots, layout, loading: planLoading, source, refresh } = useFloorPlan({
    start,
    end,
    enabled: !!start && !!end,
  });

  const routeSlot = useMemo(
    () => (slotId ? slots.find((slot) => slot.slot_id === slotId) ?? null : null),
    [slotId, slots]
  );

  const onBack = () => navigation.goBack();

  if (loading || (planLoading && slots.length === 0)) {
    return (
      <AppScreen header={<ScreenHeader title="Show me the way" onBack={onBack} />} scroll={false}>
        <View style={styles.padded}>
          <SkeletonList rows={3} />
        </View>
      </AppScreen>
    );
  }

  if (!start || !end || !slotId) {
    return (
      <AppScreen header={<ScreenHeader title="Show me the way" onBack={onBack} />} scroll={false}>
        <View style={styles.padded}>
          <EmptyState
            icon="car-outline"
            title="No active booking"
            message="Book a slot and we will guide you from the entrance to your bay."
            actionLabel="Reserve a slot"
            onAction={() => navigation.navigate('Reservation' as never)}
          />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={<ScreenHeader title="Show me the way" subtitle={routeSlot?.slot_code} onBack={onBack} />}
      scroll
      refreshing={planLoading}
      onRefresh={refresh}
    >
      <FloorPlan
        slots={slots}
        layout={layout}
        floor={routeSlot?.floor ?? 1}
        selectedSlotId={slotId}
        routeSlotId={slotId}
        showLegend
        footnote={
          source === 'local'
            ? 'Live availability needs database/live_upgrade/03_floor_plan_207.sql. The drawing is schematic, built from the layout data.'
            : null
        }
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  padded: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
  },
});
