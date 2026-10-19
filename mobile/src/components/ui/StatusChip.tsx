import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../../theme/tokens';

export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

export interface StatusChipProps {
  label: string;
  tone?: ChipTone;
  /** Override the default tone icon. Pass `null` for a text-only chip. */
  icon?: React.ComponentProps<typeof Ionicons>['name'] | null;
  style?: ViewStyle;
}

const TONE_ICON: Record<ChipTone, React.ComponentProps<typeof Ionicons>['name']> = {
  success: 'checkmark-circle',
  warning: 'alert-circle',
  danger: 'close-circle',
  info: 'information-circle',
  neutral: 'ellipse-outline',
  brand: 'car',
};

/**
 * Small status pill. Every chip carries an icon and a word, so a status is
 * never conveyed by colour alone (WCAG 1.4.1).
 */
export default function StatusChip({ label, tone = 'neutral', icon, style }: StatusChipProps) {
  const { colors, textScale } = useTheme();

  const tones: Record<ChipTone, { bg: string; fg: string }> = {
    success: { bg: colors.successTint, fg: colors.success },
    warning: { bg: colors.warningTint, fg: colors.warning },
    danger: { bg: colors.dangerTint, fg: colors.danger },
    info: { bg: colors.infoTint, fg: colors.info },
    neutral: { bg: colors.neutralTint, fg: colors.neutral },
    brand: { bg: colors.tealTint, fg: colors.tealDark },
  };

  const { bg, fg } = tones[tone];
  const glyph = icon === undefined ? TONE_ICON[tone] : icon;

  return (
    <View
      style={[styles.chip, { backgroundColor: bg, borderColor: fg }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {glyph ? <Ionicons name={glyph} size={14} color={fg} /> : null}
      <Text style={[typeToken('small', textScale), { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    minHeight: 26,
  },
});
