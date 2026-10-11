import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../theme';

export default function RegistrationScreen({ navigation }: any) {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPwd, setIsPwd] = useState(false);
  const [pwdPermitNumber, setPwdPermitNumber] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validatePlateNumber = (plate: string): boolean => {
    // Philippine plate format: 3 letters + 3 numbers (e.g., ABC123)
    const plateRegex = /^[A-Z]{3}\d{3}$/;
    return plateRegex.test(plate.toUpperCase());
  };

  const calculatePasswordStrength = (pwd: string): { score: number; label: string; color: string } => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;

    if (score <= 2) return { score, label: 'Weak', color: '#EF4444' };
    if (score <= 4) return { score, label: 'Medium', color: '#F59E0B' };
    return { score, label: 'Strong', color: '#10B981' };
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';
    
    if (!phone.trim()) newErrors.phone = 'Phone number is required';
    else if (!/^\d{11}$/.test(phone.replace(/\D/g, ''))) newErrors.phone = 'Invalid phone number (11 digits)';
    
    if (!plateNumber.trim()) newErrors.plateNumber = 'Plate number is required';
    else if (!validatePlateNumber(plateNumber)) newErrors.plateNumber = 'Invalid format (e.g., ABC123)';
    
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    
    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    
    if (isPwd && !pwdPermitNumber.trim()) newErrors.pwdPermitNumber = 'PWD permit number is required';
    
    if (!acceptTerms) newErrors.terms = 'You must accept the terms and conditions';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await register({
        full_name: fullName,
        email,
        phone,
        plate_number: plateNumber.toUpperCase(),
        password,
        pwd_permit_number: isPwd ? pwdPermitNumber : null,
      });
      Alert.alert(
        'Registration Successful',
        'Please check your email to verify your account before logging in.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = calculatePasswordStrength(password);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join ParkWise today</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={[styles.input, errors.fullName ? styles.inputError : null]}
              placeholder="Juan Dela Cruz"
              placeholderTextColor="#9CA3AF"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              editable={!loading}
            />
            {errors.fullName && <Text style={styles.errorText}>{errors.fullName}</Text>}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, errors.email ? styles.inputError : null]}
              placeholder="juan@example.com"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
            {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={[styles.input, errors.phone ? styles.inputError : null]}
              placeholder="09123456789"
              placeholderTextColor="#9CA3AF"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={11}
              editable={!loading}
            />
            {errors.phone && <Text style={styles.errorText}>{errors.phone}</Text>}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Plate Number (4-wheeled)</Text>
            <TextInput
              style={[styles.input, errors.plateNumber ? styles.inputError : null]}
              placeholder="ABC123"
              placeholderTextColor="#9CA3AF"
              value={plateNumber}
              onChangeText={(text) => setPlateNumber(text.toUpperCase())}
              autoCapitalize="characters"
              maxLength={6}
              editable={!loading}
            />
            {errors.plateNumber && <Text style={styles.errorText}>{errors.plateNumber}</Text>}
            <Text style={styles.hintText}>Format: 3 letters + 3 numbers (e.g., ABC123)</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, errors.password ? styles.inputError : null]}
                placeholder="Enter password"
                placeholderTextColor="#9CA3AF"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.eyeIcon}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text style={styles.eyeText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
            {password && (
              <View style={styles.strengthContainer}>
                <View style={[styles.strengthBar, { flex: passwordStrength.score / 6, backgroundColor: passwordStrength.color }]} />
                <Text style={[styles.strengthText, { color: passwordStrength.color }]}>
                  {passwordStrength.label}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, errors.confirmPassword ? styles.inputError : null]}
                placeholder="Confirm password"
                placeholderTextColor="#9CA3AF"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.eyeIcon}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <Text style={styles.eyeText}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
              </TouchableOpacity>
            </View>
            {errors.confirmPassword && <Text style={styles.errorText}>{errors.confirmPassword}</Text>}
          </View>

          <View style={styles.inputGroup}>
            <TouchableOpacity
              style={styles.toggleContainer}
              onPress={() => setIsPwd(!isPwd)}
              disabled={loading}
            >
              <View style={[styles.checkbox, isPwd && styles.checkboxChecked]}>
                {isPwd && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.toggleLabel}>I have a PWD permit</Text>
            </TouchableOpacity>
          </View>

          {isPwd && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>PWD Permit Number</Text>
              <TextInput
                style={[styles.input, errors.pwdPermitNumber ? styles.inputError : null]}
                placeholder="Enter permit number"
                placeholderTextColor="#9CA3AF"
                value={pwdPermitNumber}
                onChangeText={setPwdPermitNumber}
                autoCapitalize="characters"
                editable={!loading}
              />
              {errors.pwdPermitNumber && <Text style={styles.errorText}>{errors.pwdPermitNumber}</Text>}
              <Text style={styles.hintText}>Your account will be pending until verified by staff</Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <TouchableOpacity
              style={styles.toggleContainer}
              onPress={() => setAcceptTerms(!acceptTerms)}
              disabled={loading}
            >
              <View style={[styles.checkbox, acceptTerms && styles.checkboxChecked]}>
                {acceptTerms && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.toggleLabel}>
                I accept the <Text style={styles.link}>Terms and Conditions</Text>
              </Text>
            </TouchableOpacity>
            {errors.terms && <Text style={styles.errorText}>{errors.terms}</Text>}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.linkText}>Already have an account? Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    minHeight: 48,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    fontSize: fontSize.xs,
    color: '#EF4444',
    marginTop: spacing.xs,
  },
  hintText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeIcon: {
    position: 'absolute',
    right: spacing.md,
    top: '50%',
    marginTop: -12,
  },
  eyeText: {
    fontSize: 20,
  },
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  strengthBar: {
    height: 4,
    borderRadius: 2,
    flex: 1,
    backgroundColor: '#E5E7EB',
  },
  strengthText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: 'bold',
  },
  toggleLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  link: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  linkText: {
    fontSize: fontSize.sm,
    color: colors.primary,
  },
});
