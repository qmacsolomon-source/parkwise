import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../../theme/tokens';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Optional line under the title, e.g. the slot being moved to. */
  description?: string;
  children?: React.ReactNode;
  /** Rendered in a fixed footer (usually two Buttons side by side). */
  footer?: React.ReactNode;
  /** Prevents dismiss-by-backdrop, e.g. while a request is in flight. */
  dismissible?: boolean;
  style?: ViewStyle;
}

/**
 * Bottom sheet used for confirmations and slot changes instead of Alert.alert.
 * The slide animation is skipped when reduce motion is on.
 */
export default function BottomSheet({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  style,
}: BottomSheetProps) {
  const { colors, textScale, reduceMotion } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.scrim }]}
          onPress={dismissible ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessibilityElementsHidden={!dismissible}
        />

        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
            style,
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

          {title ? (
            <View style={styles.header}>
              <Text style={[typeToken('title', textScale), { color: colors.text }]}>{title}</Text>
              {dismissible ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {description ? (
            <Text style={[typeToken('body', textScale), { color: colors.textMuted, marginTop: spacing.xxs }]}>
              {description}
            </Text>
          ) : null}

          {children ? <View style={styles.body}>{children}</View> : null}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  body: {
    marginTop: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
