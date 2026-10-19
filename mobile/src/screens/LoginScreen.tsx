import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { isConfigured } from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';
import { Button, Card, TextField, ScreenHeader, BottomSheet } from '../components/ui';

type RootStackParamList = {
  Login: undefined;
  Registration: undefined;
};

type FormMessage = { tone: 'error' | 'success' | 'info'; text: string };

export default function LoginScreen() {
  const { login, resetPassword } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors, textScale } = useTheme();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);

  const tones = {
    error: { bg: colors.dangerTint, fg: colors.danger, icon: 'alert-circle' as const },
    success: { bg: colors.successTint, fg: colors.success, icon: 'checkmark-circle' as const },
    info: { bg: colors.infoTint, fg: colors.info, icon: 'information-circle' as const },
  };
  const bannerTone = tones[formMessage?.tone ?? 'info'];

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!identifier.trim()) {
      newErrors.identifier = 'Email or phone is required';
    } else if (!/\S+@\S+\.\S+/.test(identifier) && !/^\d{11}$/.test(identifier.replace(/\D/g, ''))) {
      newErrors.identifier = 'Invalid email or phone format';
    }

    if (!password) newErrors.password = 'Password is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setFormMessage(null);
    try {
      await login(identifier, password, rememberMe);
    } catch (error: any) {
      setFormMessage({ tone: 'error', text: error.message || 'Please check your credentials' });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim() || !/\S+@\S+\.\S+/.test(resetEmail)) {
      setErrors((prev) => ({ ...prev, resetEmail: 'Please enter a valid email address' }));
      return;
    }

    setErrors((prev) => ({ ...prev, resetEmail: '' }));
    setResetLoading(true);
    try {
      await resetPassword(resetEmail);
      setResetEmail('');
      setShowResetModal(false);
      setFormMessage({
        tone: 'success',
        text: 'Check your email for the password reset link.',
      });
    } catch (error: any) {
      setErrors((prev) => ({ ...prev, resetEmail: error.message || 'Please try again' }));
    } finally {
      setResetLoading(false);
    }
  };

  const handleBiometricLogin = () => {
    setFormMessage({
      tone: 'info',
      text: 'Biometric authentication will be implemented with device-specific libraries (react-native-fingerprint-scanner or expo-local-authentication).',
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.heroBg }]} edges={['top']}>
      <ScreenHeader title="ParkWise" subtitle="Customer App" hero />

      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card style={styles.card}>
            <Text style={[typeToken('title', textScale), { color: colors.text }]}>Welcome back</Text>

            {!isConfigured ? (
              <View
                style={[styles.banner, { backgroundColor: colors.dangerTint, borderColor: colors.danger }]}
                accessibilityRole="alert"
              >
                <Ionicons name="alert-circle" size={20} color={colors.danger} />
                <View style={styles.bannerBody}>
                  <Text style={[typeToken('bodyStrong', textScale), { color: colors.danger }]}>
                    Supabase is not configured
                  </Text>
                  <Text style={[typeToken('small', textScale), { color: colors.danger }]}>
                    Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env
                    file
                  </Text>
                </View>
              </View>
            ) : null}

            {formMessage ? (
              <View
                style={[styles.banner, { backgroundColor: bannerTone.bg, borderColor: bannerTone.fg }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Ionicons name={bannerTone.icon} size={20} color={bannerTone.fg} />
                <View style={styles.bannerBody}>
                  <Text style={[typeToken('small', textScale), { color: bannerTone.fg }]}>
                    {formMessage.text}
                  </Text>
                </View>
              </View>
            ) : null}

            <TextField
              label="Email or Phone"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="juan@example.com or 09123456789"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
              leadingIcon="mail-outline"
              invalid={!!errors.identifier}
              message={errors.identifier}
            />

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              secureTextEntry
              editable={!loading}
              leadingIcon="lock-closed-outline"
              invalid={!!errors.password}
              message={errors.password}
            />

            <View style={styles.row}>
              <Pressable
                onPress={() => setRememberMe((value) => !value)}
                disabled={loading}
                accessibilityRole="checkbox"
                accessibilityLabel="Remember me"
                accessibilityState={{ checked: rememberMe, disabled: loading }}
                style={styles.remember}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: rememberMe ? colors.navy : colors.borderStrong,
                      backgroundColor: rememberMe ? colors.navy : 'transparent',
                    },
                  ]}
                >
                  {rememberMe ? (
                    <Ionicons name="checkmark" size={15} color={colors.textOnDark} />
                  ) : null}
                </View>
                <Text style={[typeToken('body', textScale), { color: colors.text }]}>Remember me</Text>
              </Pressable>

              <Button
                label="Forgot Password?"
                variant="ghost"
                fullWidth={false}
                disabled={loading}
                onPress={() => setShowResetModal(true)}
                accessibilityHint="Opens password reset"
              />
            </View>

            <Button
              label="Sign In"
              size="lg"
              loading={loading}
              onPress={handleLogin}
              accessibilityHint="Signs you in with the email or phone and password above"
            />

            {biometricAvailable ? (
              <Button
                label="Use Biometric Login"
                variant="secondary"
                icon="finger-print-outline"
                disabled={loading}
                onPress={handleBiometricLogin}
              />
            ) : null}

            <Button
              label="Don't have an account? Sign Up"
              variant="ghost"
              onPress={() => navigation.navigate('Registration')}
              accessibilityHint="Opens the account registration screen"
            />
          </Card>

          <Text style={[typeToken('small', textScale), styles.footer, { color: colors.textMuted }]}>
            For customers only. Attendants should use the desktop console.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet
        visible={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Reset Password"
        description="Enter your email to receive a reset link"
        dismissible={!resetLoading}
        footer={
          <>
            <View style={styles.sheetButton}>
              <Button
                label="Cancel"
                variant="secondary"
                disabled={resetLoading}
                onPress={() => setShowResetModal(false)}
              />
            </View>
            <View style={styles.sheetButton}>
              <Button
                label="Send Reset Link"
                loading={resetLoading}
                disabled={resetLoading}
                onPress={handleResetPassword}
              />
            </View>
          </>
        }
      >
        <TextField
          label="Email"
          value={resetEmail}
          onChangeText={setResetEmail}
          placeholder="juan@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!resetLoading}
          leadingIcon="mail-outline"
          invalid={!!errors.resetEmail}
          message={errors.resetEmail}
        />
      </BottomSheet>
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
  scroll: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  remember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  sheetButton: {
    flex: 1,
  },
});
