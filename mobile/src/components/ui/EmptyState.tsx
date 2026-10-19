import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../../theme/tokens';
import Button from './Button';

export interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary action, e.g. "Change the time". */
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
  style?: ViewStyle;
}

/** Friendly empty / error state: icon, title, explanation and an action. */
export default function EmptyState({
  icon = 'information-circle-outline',
  title,
  message,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  style,
}: EmptyStateProps) {
  const { colors, textScale } = useTheme();

  return (
    <View
      style={[styles.container, compact ? styles.compact : styles.roomy, style]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${title}${message ? `. ${message}` : ''}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Ionicons name={icon} size={compact ? 24 : 32} color={colors.textMuted} />
      </View>

      <Text style={[typeToken('subtitle', textScale), styles.center, { color: colors.text }]}>{title}</Text>

      {message ? (
        <Text style={[typeToken('body', textScale), styles.center, { color: colors.textMuted }]}>
          {message}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}

      {secondaryLabel && onSecondary ? (
        <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  roomy: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  compact: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.xs,
    maxWidth: 320,
  },
});
