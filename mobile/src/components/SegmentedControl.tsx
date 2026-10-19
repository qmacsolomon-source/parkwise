import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { palette, radius, spacing, type as typeToken, TOUCH_TARGET } from '../theme/tokens';
import { useTheme } from '../contexts/AccessibilityContext';

export interface SegmentedControlOption<T extends string> {
  label: string;
  value: T;
}

interface Props<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

/** Two-or-more segment switch (Floor plan | List, tabs, text-size choices). */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: Props<T>) {
  const { colors, textScale } = useTheme();

  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, style]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text
              style={[
                typeToken('caption', textScale),
                { color: selected ? colors.navy : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
    minHeight: TOUCH_TARGET,
    alignItems: 'stretch',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.xs,
    minHeight: TOUCH_TARGET - 8,
  },
});

export { palette };
