import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, shadow, spacing, type as typeToken, TOUCH_TARGET } from '../../theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Adds a tappable row affordance and a chevron. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/** Surface container: one radius, one shadow, one border, used everywhere. */
export function Card({ children, style, onPress, accessibilityLabel, accessibilityHint }: CardProps) {
  const { colors } = useTheme();

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [
          styles.card,
          shadow.card,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.9 : 1 },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.card,
        shadow.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({ title, action, onAction, style }: SectionHeaderProps) {
  const { colors, textScale } = useTheme();

  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={[typeToken('caption', textScale), styles.sectionTitle, { color: colors.textMuted }]}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={styles.sectionAction}
        >
          <Text style={[typeToken('caption', textScale), { color: colors.tealDark }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Small trailing text, e.g. a value or a status word. */
  value?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
}

/** A single tappable line: 48 dp tall, label + optional subtitle + value. */
export function ListRow({
  title,
  subtitle,
  value,
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ListRowProps) {
  const { colors, textScale } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={20} color={colors.textMuted} /> : null}
      <View style={styles.rowText}>
        <Text style={[typeToken('body', textScale), { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>{value}</Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionAction: {
    minHeight: 32,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
});
