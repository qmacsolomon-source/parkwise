import React, { useState } from 'react';
import {
  DimensionValue,
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
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';
import { Button, Card, TextField, ScreenHeader } from '../components/ui';
import { DEFAULT_VEHICLE_TYPE, normalizePlate, plateError } from '../services/vehicles';

type RootStackParamList = {
  Login: undefined;
  Registration: undefined;
};

type FormMessage = { tone: 'error' | 'success'; text: string };

interface CheckboxRowProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function CheckboxRow({ label, checked, disabled = false, onPress }: CheckboxRowProps) {
  const { colors, textScale } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: checked ? colors.navy : colors.borderStrong,
            backgroundColor: checked ? colors.navy : 'transparent',
          },
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={15} color={colors.textOnDark} /> : null}
      </View>
      <Text style={[typeToken('body', textScale), styles.checkLabel, { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function RegistrationScreen() {
  const { register } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors, textScale } = useTheme();

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPwd, setIsPwd] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);

  const tones = {
    error: { bg: colors.dangerTint, fg: colors.danger, icon: 'alert-circle' as const },
    success: { bg: colors.successTint, fg: colors.success, icon: 'checkmark-circle' as const },
  };
  const bannerTone = tones[formMessage?.tone ?? 'error'];
  const succeeded = formMessage?.tone === 'success';

  const calculatePasswordStrength = (pwd: string): { score: number; label: string } => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;

    if (score <= 2) return { score, label: 'Weak' };
    if (score <= 4) return { score, label: 'Medium' };
    return { score, label: 'Strong' };
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) newErrors.firstName = 'First name is required';
    if (!lastName.trim()) newErrors.lastName = 'Surname is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';

    if (!phone.trim()) newErrors.phone = 'Phone number is required';
    else if (!/^\d{11}$/.test(phone.replace(/\D/g, '')))
      newErrors.phone = 'Invalid phone number (11 digits)';

    if (!plateNumber.trim()) newErrors.plateNumber = 'Plate number is required';
    else {
      const plateProblem = plateError(plateNumber);
      if (plateProblem) newErrors.plateNumber = plateProblem;
    }

    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';

    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match';

    if (!acceptTerms) newErrors.terms = 'You must accept the terms and conditions';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setFormMessage(null);
    try {
      await register({
        first_name: firstName,
        middle_name: middleName || undefined,
        last_name: lastName,
        email,
        phone,
        plate_number: normalizePlate(plateNumber),
        vehicle_type: DEFAULT_VEHICLE_TYPE,
        password,
        pwd_intent: isPwd,
      });
      setFormMessage({
        tone: 'success',
        text: isPwd
          ? 'Registration successful. Please check your email to verify your account before logging in. Since you indicated you have a PWD permit, you\'ll be asked to complete verification (permit number and photo) in Settings the first time you log in.'
          : 'Registration successful. Please check your email to verify your account before logging in.',
      });
    } catch (error: any) {
      setFormMessage({ tone: 'error', text: error.message || 'Please try again' });
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = calculatePasswordStrength(password);
  const strengthColor =
    passwordStrength.label === 'Weak'
      ? colors.danger
      : passwordStrength.label === 'Medium'
        ? colors.warning
        : colors.success;
  const strengthWidth = `${Math.round((passwordStrength.score / 6) * 100)}%` as DimensionValue;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.heroBg }]} edges={['top']}>
      <ScreenHeader
        title="ParkWise"
        subtitle="Customer App"
        hero
        onBack={() => navigation.navigate('Login')}
      />

      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card style={styles.card}>
            <View style={styles.cardHeading}>
              <Text style={[typeToken('title', textScale), { color: colors.text }]}>
                Create Account
              </Text>
              <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
                Join ParkWise today
              </Text>
            </View>

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
              label="First Name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Juan"
              autoCapitalize="words"
              editable={!loading}
              leadingIcon="person-outline"
              invalid={!!errors.firstName}
              message={errors.firstName}
            />

            <TextField
              label="Middle Name (optional)"
              value={middleName}
              onChangeText={setMiddleName}
              placeholder="Santos"
              autoCapitalize="words"
              editable={!loading}
              leadingIcon="person-outline"
            />

            <TextField
              label="Surname"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Dela Cruz"
              autoCapitalize="words"
              editable={!loading}
              leadingIcon="person-outline"
              invalid={!!errors.lastName}
              message={errors.lastName}
            />

            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="juan@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
              leadingIcon="mail-outline"
              invalid={!!errors.email}
              message={errors.email}
            />

            <TextField
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              placeholder="09123456789"
              keyboardType="phone-pad"
              maxLength={11}
              editable={!loading}
              leadingIcon="call-outline"
              invalid={!!errors.phone}
              message={errors.phone}
            />

            <View style={styles.fieldGroup}>
              <TextField
                label="Plate Number (4-wheeled)"
                value={plateNumber}
                onChangeText={(text) => setPlateNumber(text.toUpperCase())}
                placeholder="ABC1234"
                autoCapitalize="characters"
                maxLength={8}
                editable={!loading}
                leadingIcon="car-outline"
                invalid={!!errors.plateNumber}
                message={errors.plateNumber}
              />
              <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                Format: 3 letters + 3 or 4 numbers (e.g., ABC123 or ABC1234)
              </Text>
            </View>

            <View style={styles.fieldGroup}>
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
              {password ? (
                <View
                  style={styles.strength}
                  accessible
                  accessibilityLabel={`Password strength: ${passwordStrength.label}`}
                >
                  <View style={[styles.strengthTrack, { backgroundColor: colors.surfaceAlt }]}>
                    <View
                      style={[
                        styles.strengthFill,
                        { width: strengthWidth, backgroundColor: strengthColor },
                      ]}
                    />
                  </View>
                  <Text style={[typeToken('small', textScale), { color: strengthColor }]}>
                    Password strength: {passwordStrength.label}
                  </Text>
                </View>
              ) : null}
            </View>

            <TextField
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              secureTextEntry
              editable={!loading}
              leadingIcon="lock-closed-outline"
              invalid={!!errors.confirmPassword}
              message={errors.confirmPassword}
            />

            <CheckboxRow
              label="I have a PWD permit"
              checked={isPwd}
              disabled={loading}
              onPress={() => setIsPwd((value) => !value)}
            />

            {isPwd ? (
              <Text style={[typeToken('small', textScale), styles.pwdNote, { color: colors.textMuted }]}>
                You'll complete verification (permit number and photo) in Settings after you log in -
                your account stays pending until staff verify it.
              </Text>
            ) : null}

            <View style={styles.fieldGroup}>
              <CheckboxRow
                label="I accept the Terms and Conditions"
                checked={acceptTerms}
                disabled={loading}
                onPress={() => setAcceptTerms((value) => !value)}
              />
              {errors.terms ? (
                <Text
                  style={[typeToken('small', textScale), { color: colors.danger }]}
                  accessibilityLiveRegion="polite"
                >
                  {errors.terms}
                </Text>
              ) : null}
            </View>

            {succeeded ? (
              <Button
                label="Continue to Sign In"
                size="lg"
                onPress={() => navigation.navigate('Login')}
                accessibilityHint="Goes to the sign in screen"
              />
            ) : (
              <Button
                label="Create Account"
                size="lg"
                loading={loading}
                onPress={handleRegister}
                accessibilityHint="Creates your ParkWise account"
              />
            )}

            <Button
              label="Already have an account? Sign In"
              variant="ghost"
              onPress={() => navigation.navigate('Login')}
              accessibilityHint="Goes to the sign in screen"
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
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
  cardHeading: {
    gap: spacing.xxs,
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
  fieldGroup: {
    gap: spacing.xxs,
  },
  pwdNote: {
    marginTop: spacing.xxs,
  },
  strength: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  strengthTrack: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingTop: spacing.xs,
  },
  checkLabel: {
    flex: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
