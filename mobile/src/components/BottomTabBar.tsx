import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, type as typeToken } from '../theme/tokens';

export type TabKey = 'Home' | 'Reserve' | 'Timer' | 'History' | 'Profile';

interface TabDefinition {
  key: TabKey;
  label: string;
  route: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
}

const TABS: TabDefinition[] = [
  { key: 'Home', label: 'Home', route: 'Dashboard', icon: 'home-outline', iconActive: 'home' },
  { key: 'Reserve', label: 'Reserve', route: 'Reservation', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { key: 'Timer', label: 'Timer', route: 'Timer', icon: 'timer-outline', iconActive: 'timer' },
  { key: 'History', label: 'History', route: 'History', icon: 'receipt-outline', iconActive: 'receipt' },
  { key: 'Profile', label: 'Profile', route: 'Settings', icon: 'person-outline', iconActive: 'person' },
];

interface Props {
  active: TabKey;
}

/**
 * Bottom tab bar: Home, Reserve, Timer, History, Profile. Built from the
 * existing stack navigator (no extra navigation dependency), with an icon and
 * a visible label on every tab so the active tab is never conveyed by colour
 * alone.
 */
export default function BottomTabBar({ active }: Props) {
  const { colors, textScale } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ navigate: (route: string) => void }>();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.xs),
        },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Main navigation"
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const tint = selected ? colors.tealDark : colors.textMuted;

        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync().catch(() => undefined);
              navigation.navigate(tab.route);
            }}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            <View
              style={[
                styles.iconWrap,
                selected && { backgroundColor: colors.tealTint, borderColor: colors.tealDark },
              ]}
            >
              <Ionicons name={selected ? tab.iconActive : tab.icon} size={20} color={tint} />
            </View>
            <Text style={[typeToken('small', textScale), { color: tint }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 52,
  },
  iconWrap: {
    width: 40,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
