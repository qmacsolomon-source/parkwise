import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../contexts/AccessibilityContext';
import { radius, spacing } from '../../theme/tokens';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radiusToken?: keyof typeof radius;
  style?: ViewStyle;
}

/**
 * One shimmering placeholder block. The pulse is switched off when reduce
 * motion is on, which leaves a plain static block (still readable as loading).
 */
export function Skeleton({ width = '100%', height = 16, radiusToken = 'sm', style }: SkeletonProps) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(reduceMotion ? 0.6 : 0.4)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        {
          width,
          height,
          opacity: pulse,
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius[radiusToken],
        },
        style,
      ]}
    />
  );
}

export interface SkeletonListProps {
  rows?: number;
  style?: ViewStyle;
}

/** A card-shaped loading placeholder, echoed a few times to fill a list. */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: 'transparent' },
        style,
      ]}
    >
      <Skeleton width="55%" height={18} />
      <Skeleton width="80%" height={14} />
      <Skeleton width="35%" height={14} />
    </View>
  );
}

export function SkeletonList({ rows = 3, style }: SkeletonListProps) {
  return (
    <View style={[styles.list, style]}>
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
});

export default Skeleton;
