import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  FloorPlanLayout,
  FloorPlanSlot,
  describeDirections,
  describeRouteShort,
  primaryDirection,
} from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { radius, spacing, type as typeToken } from '../theme/tokens';

export interface RouteGuideProps {
  layout: FloorPlanLayout;
  slot: FloorPlanSlot;
  style?: ViewStyle;
}

const ARROW_ICON: Record<'straight' | 'left' | 'right', 'arrow-up' | 'arrow-back' | 'arrow-forward'> = {
  straight: 'arrow-up',
  left: 'arrow-back',
  right: 'arrow-forward',
};

const ARROW_WORD: Record<'straight' | 'left' | 'right', string> = {
  straight: 'Straight on',
  left: 'Turn left',
  right: 'Turn right',
};

/**
 * Layer 3 of the route guidance: a big directional arrow plus the written
 * steps, so the same directions work with the sound off, with a screen reader,
 * and for anyone who cannot read the drawing.
 */
export default function RouteGuide({ layout, slot, style }: RouteGuideProps) {
  const { colors, textScale } = useTheme();
  const steps = describeDirections(layout, slot);
  const turn = primaryDirection(layout, slot);

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      accessibilityRole="summary"
      accessibilityLabel={`Directions to slot ${slot.slot_code}. ${steps.join(' ')}`}
    >
      <View style={styles.header}>
        <View style={[styles.arrowBox, { backgroundColor: colors.tealTint, borderColor: colors.teal }]}>
          <Ionicons name={ARROW_ICON[turn]} size={34} color={colors.tealDark} />
        </View>
        <View style={styles.headerText}>
          <Text style={[typeToken('subtitle', textScale), { color: colors.text }]}>
            {ARROW_WORD[turn]}
          </Text>
          <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
            {describeRouteShort(layout, slot)}
          </Text>
        </View>
      </View>

      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepBadge, { backgroundColor: colors.navy }]}>
              <Text style={[typeToken('small', textScale), { color: colors.textOnDark }]}>
                {index + 1}
              </Text>
            </View>
            <Text
              style={[typeToken('body', textScale), styles.stepText, { color: colors.text }]}
              accessibilityRole="text"
            >
              {step}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  arrowBox: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  steps: {
    gap: spacing.xs,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepText: {
    flex: 1,
  },
});
