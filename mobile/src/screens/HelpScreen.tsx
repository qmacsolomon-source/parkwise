import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Linking } from 'react-native';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, NavigationProp } from '@react-navigation/native';

type RootStackParamList = {
  Dashboard: undefined;
  Help: undefined;
};

type FAQItem = {
  id: string;
  question: string;
  answer: string;
};

const FAQs: FAQItem[] = [
  {
    id: '1',
    question: 'How do I make a reservation?',
    answer: 'Go to the Dashboard, tap on an available slot, select your vehicle, choose start and end times, and confirm your reservation.',
  },
  {
    id: '2',
    question: 'What happens if I overstay?',
    answer: 'Overstaying will result in an overstay surcharge added to your total payment. The rate is charged per hour beyond your reserved time.',
  },
  {
    id: '3',
    question: 'Can I cancel my reservation?',
    answer: 'Yes, you can cancel. However, cancellations made within the late cancel window will incur a penalty fee.',
  },
  {
    id: '4',
    question: 'How do PWD slots work?',
    answer: 'PWD slots are reserved for verified PWD permit holders. After registration with your PWD permit number, your account will be verified by staff before you can book PWD slots.',
  },
  {
    id: '5',
    question: 'What if I miss my reservation?',
    answer: 'If you don\'t arrive within the grace period, your reservation will be marked as no-show and a penalty will be applied.',
  },
  {
    id: '6',
    question: 'How do I pay for parking?',
    answer: 'Payment is handled by parking attendants at the exit. They will calculate your total based on time used, overstay charges, and any penalties.',
  },
];

export default function HelpScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [sending, setSending] = useState(false);

  const toggleFAQ = (id: string) => {
    setExpandedFAQ(expandedFAQ === id ? null : id);
  };

  const handleSendSupport = async () => {
    if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!/\S+@\S+\.\S+/.test(contactEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setSending(true);
    // In a real app, this would send to a support ticket system
    setTimeout(() => {
      Alert.alert(
        'Support Request Sent',
        'We have received your message and will get back to you soon.',
        [{ text: 'OK', onPress: () => {
          setContactName('');
          setContactEmail('');
          setContactMessage('');
        }}]
      );
      setSending(false);
    }, 1000);
  };

  const handleCallSupport = () => {
    // In a real app, this would call the support phone number
    Alert.alert('Call Support', 'Support hotline: +63 2 8888 8888');
  };

  const handleEmailSupport = () => {
    Linking.openURL('mailto:support@parkwise.ph');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Help & Support</Text>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActionsContainer}>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={handleCallSupport}
              accessibilityLabel="Call support hotline"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>📞</Text>
              <Text style={styles.quickActionLabel}>Call Support</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={handleEmailSupport}
              accessibilityLabel="Email support"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>✉️</Text>
              <Text style={styles.quickActionLabel}>Email Us</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* FAQs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {FAQs.map(faq => (
            <TouchableOpacity
              key={faq.id}
              style={styles.faqCard}
              onPress={() => toggleFAQ(faq.id)}
              accessibilityLabel={faq.question}
              accessibilityRole="button"
              accessibilityState={{ expanded: expandedFAQ === faq.id }}
            >
              <View style={styles.faqHeader}>
                <Text style={styles.faqQuestion}>{faq.question}</Text>
                <Text style={styles.faqIcon}>{expandedFAQ === faq.id ? '−' : '+'}</Text>
              </View>
              {expandedFAQ === faq.id && (
                <Text style={styles.faqAnswer}>{faq.answer}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Contact Form */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send us a message</Text>
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor="#9CA3AF"
                value={contactName}
                onChangeText={setContactName}
                editable={!sending}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor="#9CA3AF"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!sending}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe your issue or question..."
                placeholderTextColor="#9CA3AF"
                value={contactMessage}
                onChangeText={setContactMessage}
                multiline
                numberOfLines={4}
                editable={!sending}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, sending && styles.buttonDisabled]}
              onPress={handleSendSupport}
              disabled={sending}
            >
              <Text style={styles.buttonText}>
                {sending ? 'Sending...' : 'Send Message'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Emergency Contact */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emergency</Text>
          <View style={styles.emergencyCard}>
            <Text style={styles.emergencyTitle}>Emergency Contact</Text>
            <Text style={styles.emergencyPhone}>🚨 911</Text>
            <Text style={styles.emergencyDescription}>
              For emergencies, please call emergency services directly.
            </Text>
          </View>
        </View>

        {/* App Info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>ParkWise Customer App v1.0.0</Text>
          <Text style={styles.footerText}>© 2024 ParkWise. All rights reserved.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  quickActionsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 100,
    justifyContent: 'center',
  },
  quickActionIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  quickActionLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  faqCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  faqIcon: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  faqAnswer: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
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
  textArea: {
    height: 100,
    textAlignVertical: 'top',
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
  emergencyCard: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  emergencyTitle: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.surface,
    marginBottom: spacing.sm,
  },
  emergencyPhone: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.surface,
    marginBottom: spacing.sm,
  },
  emergencyDescription: {
    fontSize: fontSize.md,
    color: colors.surface,
    textAlign: 'center',
  },
  footer: {
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
});
