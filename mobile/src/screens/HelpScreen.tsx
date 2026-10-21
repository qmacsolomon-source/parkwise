import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';

import AppScreen from '../components/AppScreen';
import { Button, Card, ListRow, SectionHeader, ScreenHeader } from '../components/ui';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';

type RootStackParamList = {
  Dashboard: undefined;
  Help: undefined;
};

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

type FaqSection = {
  title: string;
  items: FaqItem[];
};

const SUPPORT_EMAIL = 'support@parkwise.ph';
const SUPPORT_PHONE_DISPLAY = '+63 2 8888 8888';
const SUPPORT_PHONE_DIAL = '+63288888888';

const SECTIONS: FaqSection[] = [
  {
    title: 'Booking & your slot',
    items: [
      {
        id: '1',
        question: 'How do I make a reservation?',
        answer:
          'Go to the Dashboard, tap on an available slot, select your vehicle, choose start and end times, and confirm your reservation.',
      },
      {
        id: '2',
        question: 'How is my slot assigned?',
        answer:
          'When you book, ParkWise assigns an available slot for your vehicle automatically. Your assigned slot is shown on the reservation once it is confirmed.',
      },
      {
        id: '3',
        question: 'Can I change my slot?',
        answer:
          'Open your reservation and choose a different available slot. If you have already parked, ask the parking attendant to move you.',
      },
      {
        id: '4',
        question: 'Can I cancel my reservation?',
        answer:
          'Yes, you can cancel. However, cancellations made within the late cancel window will incur a penalty fee.',
      },
      {
        id: '5',
        question: 'What if I miss my reservation?',
        answer:
          "If you don't arrive within the grace period, your reservation will be marked as no-show and a penalty will be applied.",
      },
      {
        id: '6',
        question: 'How do I read the parking timer?',
        answer:
          'The timer on your reservation shows how long you have been parked and how much time remains before your booking ends.',
      },
    ],
  },
  {
    title: 'Charges & PWD',
    items: [
      {
        id: '7',
        question: 'What happens if I overstay?',
        answer:
          'Overstaying will result in an overstay surcharge added to your total payment. The rate is charged per hour beyond your reserved time.',
      },
      {
        id: '8',
        question: 'How do I pay for parking?',
        answer:
          'Payment is handled by parking attendants at the exit. They will calculate your total based on time used, overstay charges, and any penalties.',
      },
      {
        id: '9',
        question: 'How do PWD slots work?',
        answer:
          "PWD slots are reserved for verified PWD permit holders. If you checked \"I have a PWD permit\" when you registered, you'll be asked to submit your permit number and a photo in Settings - staff then verify it before PWD slots are offered to you first.",
      },
    ],
  },
];

export default function HelpScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors, textScale } = useTheme();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string) => setExpandedId((current) => (current === id ? null : id));

  return (
    <AppScreen header={<ScreenHeader title="Help & support" onBack={() => navigation.goBack()} />} scroll>
      {SECTIONS.map((section, index) => (
        <React.Fragment key={section.title}>
          <SectionHeader title={section.title} style={index > 0 ? styles.sectionSpacing : undefined} />
          <Card style={styles.faqCard}>
            {section.items.map((item) => (
              <FaqRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </Card>
        </React.Fragment>
      ))}

      <SectionHeader title="Contact" style={styles.sectionSpacing} />
      <Card>
        <Text style={[typeToken('subtitle', textScale), { color: colors.text }]}>Report a problem</Text>
        <Text style={[typeToken('body', textScale), { color: colors.textMuted, marginTop: spacing.xxs }]}>
          If something is not working or you need help with a booking, contact the ParkWise support team.
        </Text>
        <Button
          label="Email support"
          icon="mail-outline"
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          accessibilityHint={`Opens your email app to write to ${SUPPORT_EMAIL}.`}
          style={styles.contactButton}
        />
        <Button
          label={`Call ${SUPPORT_PHONE_DISPLAY}`}
          variant="secondary"
          icon="call-outline"
          onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE_DIAL}`)}
          accessibilityHint="Opens your phone app to call ParkWise support."
          style={styles.contactButton}
        />
      </Card>

      <SectionHeader title="Emergency" style={styles.sectionSpacing} />
      <Card>
        <ListRow
          title="Emergency"
          value="911"
          subtitle="For emergencies, please call emergency services directly."
          icon="warning-outline"
        />
      </Card>

      <View style={styles.footer}>
        <Text style={[typeToken('small', textScale), styles.footerText, { color: colors.textMuted }]}>
          ParkWise Customer App v1.0.0
        </Text>
        <Text style={[typeToken('small', textScale), styles.footerText, { color: colors.textMuted }]}>
          © 2024 ParkWise. All rights reserved.
        </Text>
      </View>
    </AppScreen>
  );
}

function FaqRow({
  item,
  expanded,
  onToggle,
}: {
  item: FaqItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, textScale } = useTheme();

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityHint={expanded ? 'Collapses the answer' : 'Expands the answer'}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.faqHeader,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          },
        ]}
      >
        <Text style={[typeToken('bodyStrong', textScale), styles.faqQuestion, { color: colors.text }]}>
          {item.question}
        </Text>
        <Ionicons
          name="chevron-down"
          size={20}
          color={colors.tealDark}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      {expanded ? (
        <Text style={[typeToken('body', textScale), styles.faqAnswer, { color: colors.textMuted }]}>
          {item.answer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionSpacing: {
    marginTop: spacing.lg,
  },
  faqCard: {
    padding: 0,
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  faqQuestion: {
    flex: 1,
  },
  faqAnswer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.md,
  },
  contactButton: {
    marginTop: spacing.md,
  },
  footer: {
    marginTop: spacing.xl,
    gap: spacing.xxs,
  },
  footerText: {
    textAlign: 'center',
  },
});
