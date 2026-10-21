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
import { Button, Card, TextField, ScreenHeader, BottomSheet } from '../components/ui';
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
  const [termsOpen, setTermsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
              <Pressable
                onPress={() => setTermsOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="View the Terms and Conditions"
              >
                <Text
                  style={[
                    typeToken('small', textScale),
                    styles.termsLink,
                    { color: colors.navy },
                  ]}
                >
                  View Terms and Conditions
                </Text>
              </Pressable>
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

      <BottomSheet
        visible={termsOpen}
        onClose={() => setTermsOpen(false)}
        title="Terms and Conditions"
        footer={
          <Button label="Close" onPress={() => setTermsOpen(false)} style={styles.sheetButton} />
        }
      >
        <ScrollView style={styles.termsScroll}>
          {TERMS_SECTIONS.map((section) => (
            <View key={section.heading} style={styles.termsSection}>
              <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
                {section.heading}
              </Text>
              <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
                {section.body}
              </Text>
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

interface TermsSection {
  heading: string;
  body: string;
}

const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Your account',
    body: 'You are responsible for the accuracy of the name, phone number and plate number on your account, and for keeping your password confidential. Staff may ask you to confirm your identity when picking up a reservation.',
  },
  {
    heading: '2. Reservations',
    body: 'A reservation holds a bay for the time window you set. Arriving outside that window, or with a vehicle that does not match the plate on the booking, may result in the reservation being cancelled or reassigned by staff.',
  },
  {
    heading: '3. Cancellations, no-shows and overstays',
    body: 'Cancelling close to your reservation start time, not showing up at all, or staying past your reserved end time may each incur a fee. Current rates are shown in the app before you confirm a booking and are set by facility management, not by this app.',
  },
  {
    heading: '4. Payment',
    body: 'Charges and penalties are settled on-site at the attendant counter, not inside this app. An unpaid penalty may prevent you from booking a new reservation or closing your account until it is settled.',
  },
  {
    heading: '5. PWD verification',
    body: 'If you indicate that you have a PWD permit, you will be asked to submit your permit number and a photo of it. Staff review and verify this before PWD bays are offered to you first - checking the box does not verify you automatically, and the photo is only ever visible to you and facility staff.',
  },
  {
    heading: '6. Vehicle monitoring',
    body: 'Parking bays are monitored by camera for plate verification and occupancy detection as part of normal facility operation. This is used to confirm that the vehicle in a bay matches an active reservation.',
  },
  {
    heading: '7. Liability',
    body: 'This app helps you reserve and locate a parking bay. It does not insure your vehicle or its contents against damage, loss or theft while parked at the facility.',
  },
  {
    heading: '8. Account closure',
    body: 'You may request account closure from Settings at any time. Staff review the request before anything is removed, and any unpaid penalty must be settled first.',
  },
];

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
  termsLink: {
    textDecorationLine: 'underline',
    marginLeft: TOUCH_TARGET + spacing.sm,
    marginTop: -spacing.xxs,
  },
  termsScroll: {
    maxHeight: 420,
  },
  termsSection: {
    gap: spacing.xxs,
    marginBottom: spacing.md,
  },
  sheetButton: {
    flex: 1,
  },
});
