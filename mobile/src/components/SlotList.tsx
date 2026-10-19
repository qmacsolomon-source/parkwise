import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { FloorPlanAvailabilityValue, FloorPlanSlot } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken, TOUCH_TARGET } from '../theme/tokens';
import SegmentedControl from './SegmentedControl';
import { availabilityColor, availabilityLabel } from './FloorPlan';

/**
 * The "List" half of the "Floor plan | List" switch.
 *
 * Every bay is a full-width, 48 dp row with the state written out in words, so
 * this is the precise and screen-reader friendly way to choose a bay -- the
 * drawing is only ~11 dp per bay wide on a phone.
 *
 * The groups follow the live layout: 60 block_a bays (two rows of 30) plus
 * 9 side bays on each floor.
 */
export interface SlotListProps {
  slots: FloorPlanSlot[];
  floor: number;
  onFloorChange?: (floor: number) => void;
  selectedSlotId?: string | null;
  onSelectSlot?: (slot: FloorPlanSlot) => void;
  style?: ViewStyle;
}

const ROW_GROUPS: { key: string; title: string; match: (slot: FloorPlanSlot) => boolean }[] = [
  { key: 'top', title: 'Block A · upper row', match: (s) => s.zone === 'block_a' && s.zone_row !== 'bottom' },
  { key: 'bottom', title: 'Block A · lower row', match: (s) => s.zone === 'block_a' && s.zone_row === 'bottom' },
  { key: 'side', title: 'Side column', match: (s) => s.zone === 'side' },
  { key: 'other', title: 'Other bays', match: (s) => s.zone !== 'block_a' && s.zone !== 'side' },
];

export function isSelectable(availability: FloorPlanAvailabilityValue): boolean {
  return availability === 'available';
}

export default function SlotList({
  slots,
  floor,
  onFloorChange,
  selectedSlotId,
  onSelectSlot,
  style,
}: SlotListProps) {
  const { colors, textScale } = useTheme();

  const floorSlots = useMemo(
    () => slots.filter((slot) => slot.floor === floor),
    [slots, floor]
  );

  const floors = useMemo(() => {
    const found = Array.from(new Set(slots.map((slot) => slot.floor))).sort((a, b) => a - b);
    return found.length > 0 ? found : [1, 2, 3];
  }, [slots]);

  return (
    <View style={style}>
      {onFloorChange && floors.length > 1 ? (
        <SegmentedControl
          accessibilityLabel="Choose a floor"
          options={floors.map((value) => ({ label: `Floor ${value}`, value: String(value) }))}
          value={String(floor)}
          onChange={(next) => onFloorChange(Number(next))}
          style={styles.floorSwitch}
        />
      ) : null}

      {floorSlots.length === 0 ? (
        <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
          No bays on floor {floor}.
        </Text>
      ) : null}

      {ROW_GROUPS.map((group) => {
        const groupSlots = floorSlots
          .filter(group.match)
          .sort((a, b) => a.zone_col - b.zone_col);

        if (groupSlots.length === 0) return null;

        return (
          <View key={group.key} style={styles.group}>
            <Text style={[typeToken('caption', textScale), { color: colors.textMuted }]}>
              {group.title}
            </Text>

            {groupSlots.map((slot) => {
              const selectable = isSelectable(slot.availability);
              const selected = slot.slot_id === selectedSlotId;
              const state = `${availabilityLabel(slot.availability)}${slot.is_pwd ? ', PWD' : ''}`;

              return (
                <Pressable
                  key={slot.slot_id}
                  disabled={!onSelectSlot}
                  onPress={() => onSelectSlot?.(slot)}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: !selectable }}
                  accessibilityLabel={`Slot ${slot.slot_code}, ${state}${
                    slot.entry_rank ? `, ${slot.entry_rank} closest to the entrance` : ''
                  }`}
                  accessibilityHint={selectable ? 'Selects this bay' : 'Not available in this time window'}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: selected ? colors.tealTint : colors.surface,
                      borderColor: selected ? colors.teal : colors.border,
                      opacity: selectable ? 1 : 0.6,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: availabilityColor(slot.availability, colors) },
                    ]}
                  />
                  <View style={styles.rowText}>
                    <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
                      {slot.slot_code}
                    </Text>
                    <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                      {state}
                      {slot.entry_rank ? ` · ${slot.entry_rank} nearest` : ''}
                    </Text>
                  </View>
                  {selected ? (
                    <Text style={[typeToken('caption', textScale), { color: colors.tealDark }]}>
                      Selected
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  floorSwitch: {
    marginBottom: spacing.sm,
  },
  group: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  rowText: {
    flex: 1,
  },
});
