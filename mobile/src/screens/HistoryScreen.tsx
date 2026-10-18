import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Reservation, Payment, Penalty } from '@parkwise/shared';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, NavigationProp } from '@react-navigation/native';

type RootStackParamList = {
  Dashboard: undefined;
  History: undefined;
};

export default function HistoryScreen() {
  const { profile } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'reservations' | 'payments' | 'penalties'>('reservations');

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
      const [reservationsData, paymentsData, penaltiesData] = await Promise.all([
        supabase
          .from('reservations')
          .select('*')
          .eq('customer_id', profile.id)
          .in('status', ['completed', 'cancelled', 'no_show', 'overstay'])
          .order('created_at', { ascending: false }),
        supabase
          .from('payments')
          .select('*')
          .eq('reservation_id', profile.id)
          .order('paid_at', { ascending: false }),
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return colors.success;
      case 'cancelled': return colors.textSecondary;
      case 'no_show': return colors.warning;
      case 'overstay': return colors.error;
      case 'paid': return colors.success;
      case 'unpaid': return colors.error;
      default: return colors.textSecondary;
    }
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

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.title}>Parking History</Text>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'reservations' && styles.activeTab]}
            onPress={() => setSelectedTab('reservations')}
          >
            <Text style={[styles.tabText, selectedTab === 'reservations' && styles.activeTabText]}>
              Reservations
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'payments' && styles.activeTab]}
            onPress={() => setSelectedTab('payments')}
          >
            <Text style={[styles.tabText, selectedTab === 'payments' && styles.activeTabText]}>
              Payments
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'penalties' && styles.activeTab]}
            onPress={() => setSelectedTab('penalties')}
          >
            <Text style={[styles.tabText, selectedTab === 'penalties' && styles.activeTabText]}>
              Penalties
            </Text>
          </TouchableOpacity>
        </View>

        {/* Reservations Tab */}
        {selectedTab === 'reservations' && (
          <>
            {reservations.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>🅿️</Text>
                <Text style={styles.emptyTitle}>No History</Text>
                <Text style={styles.emptyMessage}>
                  Your completed reservations will appear here.
                </Text>
              </View>
            ) : (
              reservations.map(reservation => (
                <View key={reservation.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.bookingCode}>{reservation.booking_code}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(reservation.status) }]}>
                      <Text style={styles.statusText}>{reservation.status}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Date</Text>
                    <Text style={styles.value}>{formatDate(reservation.start_time)}</Text>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Time</Text>
                    <Text style={styles.value}>
                      {formatTime(reservation.start_time)} - {formatTime(reservation.end_time)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* Payments Tab */}
        {selectedTab === 'payments' && (
          <>
            {payments.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>💳</Text>
                <Text style={styles.emptyTitle}>No Payments</Text>
                <Text style={styles.emptyMessage}>
                  Your payment history will appear here.
                </Text>
              </View>
            ) : (
              payments.map(payment => (
                <View key={payment.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Payment</Text>
                    <Text style={styles.totalAmount}>{formatCurrency(payment.total)}</Text>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Base Charge</Text>
                    <Text style={styles.value}>{formatCurrency(payment.base_charge)}</Text>
                  </View>
                  {payment.overstay_surcharge > 0 && (
                    <View style={styles.cardRow}>
                      <Text style={styles.label}>Overstay</Text>
                      <Text style={[styles.value, styles.overstayText]}>
                        {formatCurrency(payment.overstay_surcharge)}
                      </Text>
                    </View>
                  )}
                  {payment.penalty_total > 0 && (
                    <View style={styles.cardRow}>
                      <Text style={styles.label}>Penalties</Text>
                      <Text style={[styles.value, styles.penaltyText]}>
                        {formatCurrency(payment.penalty_total)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Paid At</Text>
                    <Text style={styles.value}>{formatDate(payment.paid_at)}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {/* Penalties Tab */}
        {selectedTab === 'penalties' && (
          <>
            {penalties.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>✅</Text>
                <Text style={styles.emptyTitle}>No Penalties</Text>
                <Text style={styles.emptyMessage}>
                  Great job! You have no penalties.
                </Text>
              </View>
            ) : (
              penalties.map(penalty => (
                <View key={penalty.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{penalty.type.replace('_', ' ').toUpperCase()}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(penalty.status) }]}>
                      <Text style={styles.statusText}>{penalty.status}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Amount</Text>
                    <Text style={[styles.value, styles.penaltyText]}>
                      {formatCurrency(penalty.amount)}
                    </Text>
                  </View>
                  <View style={styles.cardRow}>
                    <Text style={styles.label}>Date</Text>
                    <Text style={styles.value}>{formatDate(penalty.created_at)}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
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
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: spacing.lg,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  activeTabText: {
    color: colors.surface,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  bookingCode: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.primary,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.text,
  },
  totalAmount: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.success,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  statusText: {
    fontSize: fontSize.xs,
    color: colors.surface,
    fontWeight: '600',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  value: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  overstayText: {
    color: colors.warning,
  },
  penaltyText: {
    color: colors.error,
  },
});
