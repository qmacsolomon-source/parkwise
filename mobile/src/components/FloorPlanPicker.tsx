import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { FloorPlanLayout, FloorPlanSlot } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, type as typeToken } from '../theme/tokens';
import SegmentedControl from './SegmentedControl';
import FloorPlan, { FloorPlanLegend } from './FloorPlan';
import SlotList from './SlotList';

export type FloorPlanView = 'plan' | 'list';

export interface FloorPlanPickerProps {
  slots: FloorPlanSlot[];
  layout: FloorPlanLayout;
  loading?: boolean;
  error?: string | null;
  /** Where the plan came from, shown as small print. */
  source?: 'database' | 'local';
  selectedSlotId?: string | null;
  onSelectSlot?: (slot: FloorPlanSlot) => void;
  routeSlotId?: string | null;
  floor?: number;
  onFloorChange?: (floor: number) => void;
  defaultView?: FloorPlanView;
  style?: ViewStyle;
}

/**
 * "Floor plan | List" switch plus both views, sharing one floor and one
 * selection. The drawing is the glanceable view; the list is the accessible,
 * precise one. Both are always reachable with one tap (WCAG 1.4.1 -- nothing
 * is conveyed by colour or by the picture alone).
 */
export default function FloorPlanPicker({
  slots,
  layout,
  loading = false,
  error = null,
  source,
  selectedSlotId,
  onSelectSlot,
  routeSlotId,
  floor,
  onFloorChange,
  defaultView = 'plan',
  style,
}: FloorPlanPickerProps) {
  const { colors, textScale } = useTheme();
  const [view, setView] = useState<FloorPlanView>(defaultView);
  const [innerFloor, setInnerFloor] = useState(floor ?? 1);

  const selectedFloor = useMemo(() => {
    if (floor !== undefined) return floor;
    const selected = slots.find((slot) => slot.slot_id === selectedSlotId);
    return selected?.floor ?? innerFloor;
  }, [floor, innerFloor, slots, selectedSlotId]);

  // Follow the selection onto its floor (e.g. after a slot is assigned).
  useEffect(() => {
    if (floor !== undefined) return;
    const selected = slots.find((slot) => slot.slot_id === selectedSlotId);
    if (selected) setInnerFloor(selected.floor);
  }, [floor, slots, selectedSlotId]);

  const handleFloorChange = (next: number) => {
    setInnerFloor(next);
    onFloorChange?.(next);
  };

  return (
    <View style={style}>
      <SegmentedControl
        accessibilityLabel="How to choose a bay"
        options={[
          { label: 'Floor plan', value: 'plan' },
          { label: 'List', value: 'list' },
        ]}
        value={view}
        onChange={setView}
        style={styles.viewSwitch}
      />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.teal} />
          <Text style={[typeToken('caption', textScale), { color: colors.textMuted }]}>
            Loading the floor plan…
          </Text>
        </View>
      ) : error ? (
        <Text style={[typeToken('body', textScale), { color: colors.danger }]}>{error}</Text>
      ) : view === 'plan' ? (
        <FloorPlan
          slots={slots}
          layout={layout}
          floor={selectedFloor}
          onFloorChange={handleFloorChange}
          selectedSlotId={selectedSlotId}
          routeSlotId={routeSlotId}
          onSelectSlot={onSelectSlot}
          showLegend={false}
          footnote={
            source === 'local'
              ? 'Live availability needs database/live_upgrade/03_floor_plan_207.sql. The drawing is schematic, built from the layout data.'
              : null
          }
        />
      ) : (
        <SlotList
          slots={slots}
          floor={selectedFloor}
          onFloorChange={handleFloorChange}
          selectedSlotId={selectedSlotId}
          onSelectSlot={onSelectSlot}
        />
      )}

      {view === 'plan' && !loading && !error ? (
        <FloorPlanLegend textScale={textScale} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewSwitch: {
    marginBottom: spacing.sm,
  },
  state: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
});
