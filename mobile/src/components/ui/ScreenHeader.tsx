import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { spacing, TOUCH_TARGET, type as typeToken } from '../../theme/tokens';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Shows a back chevron on the leading edge. */
  onBack?: () => void;
  /** Optional trailing icon action (e.g. notifications). */
  actionIcon?: React.ComponentProps<typeof Ionicons>['name'];
  onAction?: () => void;
  actionLabel?: string;
  /** Renders the title at display size on a tinted hero band. */
  hero?: boolean;
  style?: ViewStyle;
}

/** Large-title screen header used at the top of every screen. */
export default function ScreenHeader({
  title,
  subtitle,
  onBack,
  actionIcon,
  onAction,
  actionLabel,
  hero = false,
  style,
}: ScreenHeaderProps) {
  const { colors, textScale } = useTheme();

  return (
    <View
      style={[
        styles.container,
        hero && { backgroundColor: colors.heroBg, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
        style,
      ]}
    >
      <View style={styles.topRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={styles.iconButton}
          >
            <Ionicons name="chevron-back" size={24} color={hero ? colors.heroText : colors.text} />
          </Pressable>
        ) : null}

        {actionIcon && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel ?? 'More'}
            hitSlop={8}
            style={[styles.iconButton, styles.iconButtonEnd]}
          >
            <Ionicons name={actionIcon} size={22} color={hero ? colors.heroText : colors.text} />
          </Pressable>
        ) : null}
      </View>

      <Text
        style={[
          typeToken('display', textScale),
          styles.title,
          { color: hero ? colors.heroText : colors.text, marginTop: onBack || actionIcon ? spacing.xxs : 0 },
        ]}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {subtitle ? (
        <Text
          style={[
            typeToken('body', textScale),
            { color: hero ? colors.heroMuted : colors.textMuted, marginTop: spacing.xxs },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
  },
  iconButton: {
    minWidth: TOUCH_TARGET,
    minHeight: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  iconButtonEnd: {
    alignItems: 'flex-end',
  },
  title: {
    marginTop: spacing.xxs,
  },
});
