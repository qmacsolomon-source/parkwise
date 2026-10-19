import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing } from '../theme/tokens';
import BottomTabBar, { TabKey } from './BottomTabBar';

export interface AppScreenProps {
  children: React.ReactNode;
  /** Usually a <ScreenHeader />. */
  header?: React.ReactNode;
  /** Renders the bottom tab bar with this tab highlighted. */
  tab?: TabKey;
  /** Wrap the content in a vertical ScrollView (default true). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  /** Set false for full-bleed content such as the floor plan. */
  padded?: boolean;
  /** Content pinned under the scroll area, e.g. a primary action. */
  footer?: React.ReactNode;
}

/**
 * Every screen's frame: one background colour, one horizontal padding, an
 * optional header, optional pull-to-refresh and an optional bottom tab bar.
 */
export default function AppScreen({
  children,
  header,
  tab,
  scroll = true,
  refreshing,
  onRefresh,
  contentStyle,
  padded = true,
  footer,
}: AppScreenProps) {
  const { colors } = useTheme();

  const content = (
    <View style={[padded && styles.padded, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      {header}

      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh
              ? (
                  <RefreshControl
                    refreshing={!!refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.tealDark}
                    colors={[colors.tealDark]}
                  />
                )
              : undefined
          }
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{content}</View>
      )}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
      {tab ? <BottomTabBar active={tab} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  padded: {
    paddingHorizontal: spacing.screen,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
