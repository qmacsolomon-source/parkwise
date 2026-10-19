import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../../theme/tokens';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Validation or helper text shown under the field and read by screen readers. */
  message?: string;
  invalid?: boolean;
  required?: boolean;
  /** Optional leading icon inside the field. */
  leadingIcon?: React.ComponentProps<typeof Ionicons>['name'];
  containerStyle?: ViewStyle;
}

/**
 * Labelled text input. The label is a real (accessible) label rather than a
 * placeholder, so it does not vanish once the field has content, and errors are
 * announced next to the field instead of only flashing a colour. When
 * `secureTextEntry` is set a show/hide toggle is added.
 */
export default function TextField({
  label,
  message,
  invalid = false,
  required = false,
  leadingIcon,
  containerStyle,
  secureTextEntry,
  ...inputProps
}: TextFieldProps) {
  const { colors, textScale } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;
  const messageColour = invalid ? colors.danger : colors.textMuted;

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[typeToken('caption', textScale), { color: colors.text }]}>
        {label}
        {required ? ' *' : ''}
      </Text>

      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.surface,
            borderColor: invalid ? colors.danger : colors.border,
          },
        ]}
      >
        {leadingIcon ? <Ionicons name={leadingIcon} size={18} color={colors.textMuted} /> : null}

        <TextInput
          {...inputProps}
          secureTextEntry={isPassword && !revealed}
          accessibilityLabel={label}
          accessibilityState={{ disabled: inputProps.editable === false }}
          style={[typeToken('body', textScale), styles.input, { color: colors.text }]}
          placeholderTextColor={colors.textMuted}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            style={styles.toggle}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>

      {message ? (
        <Text
          style={[typeToken('small', textScale), { color: messageColour }]}
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  toggle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
