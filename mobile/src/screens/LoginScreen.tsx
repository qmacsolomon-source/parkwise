import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, borderRadius, fontSize } from '../theme';

export default function LoginScreen({ navigation }: any) {
  const { login, resetPassword } = useAuth();
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
    try {
      await login(identifier, password, rememberMe);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Please check your credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim() || !/\S+@\S+\.\S+/.test(resetEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setResetLoading(true);
    try {
      await resetPassword(resetEmail);
      Alert.alert(
        'Password Reset Sent',
        'Check your email for the password reset link',
        [{ text: 'OK', onPress: () => setShowResetModal(false) }]
      );
      setResetEmail('');
    } catch (error: any) {
      Alert.alert('Reset Failed', error.message || 'Please try again');
    } finally {
      setResetLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    Alert.alert('Biometric Login', 'Biometric authentication will be implemented with device-specific libraries (react-native-fingerprint-scanner or expo-local-authentication)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>ParkWise</Text>
          <Text style={styles.subtitle}>Customer App</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email or Phone</Text>
            <TextInput
              style={[styles.input, errors.identifier && styles.inputError]}
              placeholder="juan@example.com or 09123456789"
              placeholderTextColor="#9CA3AF"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
            {errors.identifier && <Text style={styles.errorText}>{errors.identifier}</Text>}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, errors.password && styles.inputError]}
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
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.toggleContainer}
              onPress={() => setRememberMe(!rememberMe)}
              disabled={loading}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.toggleLabel}>Remember me</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowResetModal(true)}
              disabled={loading}
            >
              <Text style={styles.link}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          {biometricAvailable && (
            <TouchableOpacity
              style={styles.biometricButton}
              onPress={handleBiometricLogin}
              disabled={loading}
            >
              <Text style={styles.biometricButtonText}>👆 Use Biometric Login</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => navigation.navigate('Registration')}
          >
            <Text style={styles.linkText}>Don't have an account? Sign Up</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>
            For customers only. Attendants should use the desktop console.
          </Text>
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      {showResetModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.modalSubtitle}>Enter your email to receive a reset link</Text>
            
            <TextInput
              style={styles.input}
              placeholder="juan@example.com"
              placeholderTextColor="#9CA3AF"
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!resetLoading}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setShowResetModal(false)}
                disabled={resetLoading}
              >
                <Text style={styles.modalButtonTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleResetPassword}
                disabled={resetLoading}
              >
                <Text style={styles.modalButtonTextPrimary}>
                  {resetLoading ? 'Sending...' : 'Send Reset Link'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
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
    fontSize: fontSize.sm,
    color: colors.primary,
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
  biometricButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  biometricButtonText: {
    color: colors.primary,
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
  footer: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  modalButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalButtonPrimary: {
    backgroundColor: colors.primary,
  },
  modalButtonTextSecondary: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  modalButtonTextPrimary: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
