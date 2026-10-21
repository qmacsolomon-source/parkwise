import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Reservation, Payment, Penalty } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';
import { Card, EmptyState, ScreenHeader, SectionHeader, SkeletonList, StatusChip } from '../components/ui';
import type { ChipTone } from '../components/ui';
import AppScreen from '../components/AppScreen';

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function reservationTone(status: string): ChipTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'no_show':
      return 'warning';
    case 'overstay':
      return 'danger';
    case 'cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function penaltyTone(status: string): ChipTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'unpaid':
      return 'danger';
    default:
      return 'neutral';
  }
}

interface AmountRowProps {
  label: string;
  value: string;
  strong?: boolean;
}

function AmountRow({ label, value, strong = false }: AmountRowProps) {
  const { colors, textScale } = useTheme();

  return (
    <View
      style={styles.amountRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text
        style={[
          typeToken(strong ? 'bodyStrong' : 'body', textScale),
          { color: strong ? colors.text : colors.textMuted },
        ]}
      >
        {label}
      </Text>
      <Text style={[typeToken(strong ? 'subtitle' : 'bodyStrong', textScale), { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

export default function HistoryScreen() {
  const { profile } = useAuth();
  const { colors, textScale } = useTheme();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    loadData();
  }, [profile?.id]);

  const loadData = async () => {
    if (!supabase || !profile?.id) {
      setLoading(false);
      return;
    }

    try {
      // payments has no customer_id of its own - only reservation_id - so it
      // can only be filtered to this customer's own payments once their
      // reservation ids are known.
      const reservationsData = await supabase
        .from('reservations')
        .select('*')
        .eq('customer_id', profile.id)
        .in('status', ['completed', 'cancelled', 'no_show', 'overstay'])
        .order('created_at', { ascending: false });

      const reservationIds = (reservationsData.data ?? []).map((reservation) => reservation.id);

      const [paymentsData, penaltiesData] = await Promise.all([
        reservationIds.length
          ? supabase
              .from('payments')
              .select('*')
              .in('reservation_id', reservationIds)
              .order('paid_at', { ascending: false })
          : Promise.resolve({ data: [] as Payment[], error: null }),
        supabase
          .from('penalties')
          .select('*')
          .eq('customer_id', profile.id)
          .order('created_at', { ascending: false }),
      ]);

      if (reservationsData.data) setReservations(reservationsData.data);
      if (paymentsData.data) setPayments(paymentsData.data);
      if (penaltiesData.data) setPenalties(penaltiesData.data);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return `₱${amount.toFixed(2)}`;
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <AppScreen
      header={
        <ScreenHeader
          title="History"
          subtitle={
            reservations.length > 0
              ? `${reservations.length} past reservation${reservations.length === 1 ? '' : 's'}`
              : undefined
          }
        />
      }
      tab="History"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <SectionHeader title="Reservation history" style={styles.section} />

          {reservations.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No history yet"
              message="Your completed reservations will appear here."
            />
          ) : (
            reservations.map((reservation) => {
              const expanded = expandedId === reservation.id;
              const payment = payments.find((item) => item.reservation_id === reservation.id);
              const windowLabel = `${formatTime(reservation.start_time)} – ${formatTime(
                reservation.end_time
              )}`;

              return (
                <Card key={reservation.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.cardTopText}>
                      <Text
                        style={[typeToken('subtitle', textScale), { color: colors.navy }]}
                        numberOfLines={1}
                      >
                        {reservation.booking_code}
                      </Text>
                      <Text
                        style={[typeToken('small', textScale), { color: colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {formatDate(reservation.start_time)} · {windowLabel}
                      </Text>
                    </View>
                    <StatusChip
                      label={humanize(reservation.status)}
                      tone={reservationTone(reservation.status)}
                    />
                  </View>

                  <View
                    style={styles.slotRow}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={`Slot: ${reservation.slot_id}`}
                  >
                    <Ionicons name="car-outline" size={18} color={colors.textMuted} />
                    <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
                      Slot
                    </Text>
                    <Text
                      style={[
                        typeToken('bodyStrong', textScale),
                        styles.slotValue,
                        { color: colors.text },
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {reservation.slot_id}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => toggleExpanded(reservation.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`Itemized detail for ${reservation.booking_code}`}
                    accessibilityHint={expanded ? 'Collapses the charges' : 'Expands the charges'}
                    style={({ pressed }) => [
                      styles.toggle,
                      {
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[typeToken('bodyStrong', textScale), { color: colors.tealDark }]}>
                      Itemized detail
                    </Text>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.tealDark}
                    />
                  </Pressable>

                  {expanded ? (
                    <View style={styles.items}>
                      <AmountRow
                        label="Base charge"
                        value={payment ? formatCurrency(payment.base_charge) : '—'}
                      />
                      <AmountRow
                        label="Overstay surcharge"
                        value={payment ? formatCurrency(payment.overstay_surcharge) : '—'}
                      />
                      <AmountRow
                        label="Penalty total"
                        value={payment ? formatCurrency(payment.penalty_total) : '—'}
                      />
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      <AmountRow
                        label="Total"
                        value={payment ? formatCurrency(payment.total) : '—'}
                        strong
                      />

                      {!payment ? (
                        <Text
                          style={[typeToken('small', textScale), styles.note, { color: colors.textMuted }]}
                        >
                          No itemized charges recorded for this reservation.
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })
          )}

          {penalties.length > 0 ? (
            <>
              <SectionHeader title="Penalties" style={styles.sectionSpacious} />
              {penalties.map((penalty) => (
                <Card key={penalty.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.cardTopText}>
                      <Text
                        style={[typeToken('subtitle', textScale), { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {humanize(penalty.type)}
                      </Text>
                      <Text
                        style={[typeToken('small', textScale), { color: colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {formatDate(penalty.created_at)}
                      </Text>
                    </View>
                    <StatusChip
                      label={humanize(penalty.status)}
                      tone={penaltyTone(penalty.status)}
                    />
                  </View>

                  <View
                    style={styles.slotRow}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={`Amount: ${formatCurrency(penalty.amount)}`}
                  >
                    <Ionicons name="pricetag-outline" size={18} color={colors.textMuted} />
                    <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
                      Amount
                    </Text>
                    <Text
                      style={[
                        typeToken('bodyStrong', textScale),
                        styles.slotValue,
                        { color: colors.danger },
                      ]}
                    >
                      {formatCurrency(penalty.amount)}
                    </Text>
                  </View>
                </Card>
              ))}
            </>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.sm,
  },
  sectionSpacious: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    marginBottom: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTopText: {
    flex: 1,
    gap: spacing.xxs,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  slotValue: {
    flex: 1,
    textAlign: 'right',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
  },
  items: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 32,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xxs,
  },
  note: {
    marginTop: spacing.xxs,
  },
});
