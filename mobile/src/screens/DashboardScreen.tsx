import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot, Reservation, Vehicle } from '@parkwise/shared';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, NavigationProp } from '@react-navigation/native';

type RootStackParamList = {
  Dashboard: undefined;
  Reservation: { slot: Slot };
  Timer: undefined;
  Notifications: undefined;
  History: undefined;
  Settings: undefined;
  Help: undefined;
};

export default function DashboardScreen() {
  const { profile, logout } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    loadData();

    const slotsSubscription = supabase
      .channel('slots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSlots(prev => [...prev, payload.new as Slot]);
        } else if (payload.eventType === 'UPDATE') {
          setSlots(prev => prev.map(s => s.id === payload.new.id ? payload.new as Slot : s));
        } else if (payload.eventType === 'DELETE') {
          setSlots(prev => prev.filter(s => s.id !== payload.old.id));
        }
      })
      .subscribe();

    const reservationsSubscription = supabase
      .channel('reservations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setReservations(prev => [payload.new as Reservation, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setReservations(prev => prev.map(r => r.id === payload.new.id ? payload.new as Reservation : r));
        } else if (payload.eventType === 'DELETE') {
          setReservations(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      slotsSubscription.unsubscribe();
      reservationsSubscription.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    if (!supabase) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [slotsData, reservationsData, vehiclesData] = await Promise.all([
        supabase.from('slots').select('*').order('slot_code'),
        supabase.from('reservations').select('*').eq('customer_id', profile?.id).order('created_at', { ascending: false }),
        supabase.from('vehicles').select('*').eq('owner_id', profile?.id),
      ]);

      if (slotsData.data) setSlots(slotsData.data);
      if (reservationsData.data) setReservations(reservationsData.data);
      if (vehiclesData.data) setVehicles(vehiclesData.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleLogout = async () => {
    await logout();
  };

  const getAvailableSlots = () => {
    return slots.filter(s => s.status === 'available');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return colors.success;
      case 'reserved': return colors.warning;
      case 'occupied': return colors.success;
      case 'verified': return colors.success;
      case 'pending': return colors.warning;
      case 'completed': return colors.success;
      case 'cancelled': return colors.textSecondary;
      case 'overstay': return colors.error;
      default: return colors.textSecondary;
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome,</Text>
          <Text style={styles.userName}>{profile?.full_name}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActionsContainer}>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('Timer')}
              accessibilityLabel="View active parking timer"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>⏱️</Text>
              <Text style={styles.quickActionLabel}>Timer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('Notifications')}
              accessibilityLabel="View notifications"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>🔔</Text>
              <Text style={styles.quickActionLabel}>Alerts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('History')}
              accessibilityLabel="View parking history"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>📋</Text>
              <Text style={styles.quickActionLabel}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('Settings')}
              accessibilityLabel="Open settings"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>⚙️</Text>
              <Text style={styles.quickActionLabel}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionButton}
              onPress={() => navigation.navigate('Help')}
              accessibilityLabel="Get help and support"
              accessibilityRole="button"
            >
              <Text style={styles.quickActionIcon}>❓</Text>
              <Text style={styles.quickActionLabel}>Help</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Slots ({getAvailableSlots().length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotsContainer}>
            {getAvailableSlots().map(slot => (
              <TouchableOpacity
                key={slot.id}
                style={[styles.slotCard, slot.is_pwd && styles.pwdSlot]}
                onPress={() => navigation.navigate('Reservation', { slot })}
              >
                <Text style={styles.slotCode}>{slot.slot_code}</Text>
                {slot.is_pwd && <Text style={styles.pwdLabel}>PWD</Text>}
                <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(slot.status) }]} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Reservations ({reservations.length})</Text>
          {reservations.length === 0 ? (
            <Text style={styles.emptyText}>No reservations yet</Text>
          ) : (
            reservations.map(reservation => (
              <View key={reservation.id} style={styles.reservationCard}>
                <View style={styles.reservationHeader}>
                  <Text style={styles.bookingCode}>{reservation.booking_code}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(reservation.status) }]}>
                    <Text style={styles.statusText}>{reservation.status}</Text>
                  </View>
                </View>
                <Text style={styles.reservationDetail}>
                  Status: {reservation.status}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Vehicles ({vehicles.length})</Text>
          {vehicles.map(vehicle => (
            <View key={vehicle.id} style={styles.vehicleCard}>
              <Text style={styles.plateNumber}>{vehicle.plate_number}</Text>
              <Text style={styles.vehicleType}>{vehicle.vehicle_type}</Text>
              {vehicle.is_default && <Text style={styles.defaultLabel}>Default</Text>}
            </View>
          ))}
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
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  header: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  userName: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.primary,
  },
  logoutButton: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  logoutText: {
    color: colors.surface,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  quickActionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  quickActionButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    width: '30%',
    minWidth: 80,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  quickActionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: spacing.md,
  },
  slotsContainer: {
    flexDirection: 'row',
  },
  slotCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginRight: spacing.md,
    minWidth: 100,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  pwdSlot: {
    borderWidth: 2,
    borderColor: colors.info,
  },
  slotCode: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.primary,
  },
  pwdLabel: {
    fontSize: fontSize.xs,
    color: colors.info,
    marginTop: spacing.xs,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.lg,
  },
  reservationCard: {
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
  reservationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  bookingCode: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.primary,
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
  reservationDetail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  vehicleCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  plateNumber: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
    color: colors.primary,
  },
  vehicleType: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  defaultLabel: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '600',
  },
});
