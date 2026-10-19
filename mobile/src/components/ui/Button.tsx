import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

/** Comfortably above the 48 dp minimum touch target. */
export const BUTTON_HEIGHT = 52;

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconPosition?: 'left' | 'right';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Long build-up text for screen readers; defaults to the label. */
  accessibilityHint?: string;
  style?: ViewStyle;
}

/**
 * The one button used everywhere. Always at least 48 dp tall, always announces
 * whether it is disabled or busy, and never conveys its role by colour alone
 * (each variant keeps a text label).
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  disabled = false,
  loading = false,
  fullWidth = true,
  accessibilityHint,
  style,
}: ButtonProps) {
  const { colors, textScale } = useTheme();
  const inactive = disabled || loading;

  const backgroundColor =
    variant === 'primary'
      ? colors.navy
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surface
          : 'transparent';

  const foreground =
    variant === 'primary' || variant === 'danger'
      ? colors.textOnDark
      : variant === 'secondary'
        ? colors.navy
        : colors.navy;

  const handlePress = () => {
    if (inactive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        {
          backgroundColor,
          borderColor: variant === 'secondary' ? colors.borderStrong : backgroundColor,
          opacity: inactive ? 0.55 : pressed ? 0.88 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' ? (
            <Ionicons name={icon} size={18} color={foreground} />
          ) : null}
          <Text style={[typeToken(size === 'lg' ? 'bodyStrong' : 'body', textScale), { color: foreground }]}>
            {label}
          </Text>
          {icon && iconPosition === 'right' ? (
            <Ionicons name={icon} size={18} color={foreground} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: BUTTON_HEIGHT,
  },
  md: {
    minHeight: BUTTON_HEIGHT,
  },
  lg: {
    minHeight: 56,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
