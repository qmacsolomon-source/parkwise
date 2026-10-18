import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, AccessibilityInfo } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, NavigationProp } from '@react-navigation/native';

type RootStackParamList = {
  Dashboard: undefined;
  Settings: undefined;
};

type TextSize = 'small' | 'medium' | 'large';

export default function SettingsScreen() {
  const { profile, logout } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [highContrast, setHighContrast] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    // Check if screen reader is enabled
    AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      setScreenReaderEnabled(enabled);
    });

    // Listen for screen reader changes
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      enabled => {
        setScreenReaderEnabled(enabled);
      }
    );

    return () => subscription.remove();
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const getTextSizeMultiplier = (): number => {
    switch (textSize) {
      case 'small': return 0.85;
      case 'medium': return 1;
      case 'large': return 1.15;
      default: return 1;
    }
  };

  const currentColors = highContrast
    ? {
        ...colors,
        background: '#000000',
        surface: '#1A1A1A',
        text: '#FFFFFF',
        textSecondary: '#CCCCCC',
        border: '#FFFFFF',
        primary: '#FFFFFF',
        accent: '#FFFF00',
      }
    : colors;

  const styles = createStyles(currentColors, getTextSizeMultiplier());

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Settings</Text>

        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{profile?.full_name}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{profile?.email}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Phone</Text>
              <Text style={styles.value}>{profile?.phone}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Role</Text>
              <Text style={styles.value}>{profile?.role}</Text>
            </View>
          </View>
        </View>

        {/* Accessibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accessibility</Text>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Text Size</Text>
                <Text style={styles.settingDescription}>
                  Adjust the size of text throughout the app
                </Text>
              </View>
              <View style={styles.textSizeButtons}>
                <TouchableOpacity
                  style={[
                    styles.textSizeButton,
                    textSize === 'small' && styles.textSizeButtonActive,
                  ]}
                  onPress={() => setTextSize('small')}
                  accessibilityLabel="Small text size"
                  accessibilityRole="button"
                  accessibilityState={{ selected: textSize === 'small' }}
                >
                  <Text style={[
                    styles.textSizeButtonText,
                    textSize === 'small' && styles.textSizeButtonTextActive,
                  ]}>A</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.textSizeButton,
                    textSize === 'medium' && styles.textSizeButtonActive,
                  ]}
                  onPress={() => setTextSize('medium')}
                  accessibilityLabel="Medium text size"
                  accessibilityRole="button"
                  accessibilityState={{ selected: textSize === 'medium' }}
                >
                  <Text style={[
                    styles.textSizeButtonText,
                    textSize === 'medium' && styles.textSizeButtonTextActive,
                  ]}>A</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.textSizeButton,
                    textSize === 'large' && styles.textSizeButtonActive,
                  ]}
                  onPress={() => setTextSize('large')}
                  accessibilityLabel="Large text size"
                  accessibilityRole="button"
                  accessibilityState={{ selected: textSize === 'large' }}
                >
                  <Text style={[
                    styles.textSizeButtonText,
                    textSize === 'large' && styles.textSizeButtonTextActive,
                  ]}>A</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>High Contrast</Text>
                <Text style={styles.settingDescription}>
                  Increase contrast for better visibility
                </Text>
              </View>
              <Switch
                value={highContrast}
                onValueChange={setHighContrast}
                trackColor={{ false: currentColors.border, true: currentColors.accent }}
                thumbColor={highContrast ? currentColors.accent : currentColors.textSecondary}
                accessibilityLabel="Toggle high contrast mode"
                accessibilityRole="switch"
                accessibilityState={{ checked: highContrast }}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Screen Reader</Text>
                <Text style={styles.settingDescription}>
                  {screenReaderEnabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>
              <View style={[
                styles.statusBadge,
                { backgroundColor: screenReaderEnabled ? currentColors.success : currentColors.textSecondary },
              ]}>
                <Text style={styles.statusText}>
                  {screenReaderEnabled ? 'ON' : 'OFF'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
              accessibilityLabel="Log out of your account"
              accessibilityRole="button"
            >
              <Text style={styles.logoutButtonText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>App Version</Text>
              <Text style={styles.value}>1.0.0</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>ParkWise</Text>
              <Text style={styles.value}>Customer App</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (currentColors: any, multiplier: number) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: currentColors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl * multiplier,
    fontWeight: 'bold',
    color: currentColors.primary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg * multiplier,
    fontWeight: '600',
    color: currentColors.textSecondary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: currentColors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    shadowColor: currentColors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.md * multiplier,
    color: currentColors.textSecondary,
  },
  value: {
    fontSize: fontSize.md * multiplier,
    fontWeight: '600',
    color: currentColors.text,
  },
  settingRow: {
    marginBottom: spacing.lg,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: currentColors.border,
    paddingBottom: spacing.lg,
    marginBottom: spacing.lg,
  },
  settingInfo: {
    marginBottom: spacing.sm,
  },
  settingLabel: {
    fontSize: fontSize.md * multiplier,
    fontWeight: '600',
    color: currentColors.text,
    marginBottom: spacing.xs,
  },
  settingDescription: {
    fontSize: fontSize.sm * multiplier,
    color: currentColors.textSecondary,
  },
  textSizeButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  textSizeButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: currentColors.background,
    borderWidth: 2,
    borderColor: currentColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSizeButtonActive: {
    backgroundColor: currentColors.primary,
    borderColor: currentColors.primary,
  },
  textSizeButtonText: {
    fontSize: 14,
    color: currentColors.text,
  },
  textSizeButtonTextActive: {
    color: currentColors.surface,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  statusText: {
    fontSize: fontSize.sm * multiplier,
    fontWeight: '600',
    color: currentColors.surface,
  },
  logoutButton: {
    backgroundColor: currentColors.error,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: currentColors.surface,
    fontSize: fontSize.md * multiplier,
    fontWeight: '600',
  },
});
