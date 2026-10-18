import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, TextInput } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot, Vehicle, Reservation } from '@parkwise/shared';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, useRoute, NavigationProp, RouteProp } from '@react-navigation/native';

type RootStackParamList = {
  Dashboard: undefined;
  Reservation: { slot: Slot };
  Timer: undefined;
  Notifications: undefined;
  History: undefined;
  Settings: undefined;
  Help: undefined;
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (date: Date) => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ReservationScreen() {
  const { profile } = useAuth();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Reservation'>>();
  const { slot } = route.params;

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 60 * 60 * 1000)); // 1 hour from now
  const [loading, setLoading] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [startTextInput, setStartTextInput] = useState(formatTime(new Date()));
  const [endTextInput, setEndTextInput] = useState(formatTime(new Date(Date.now() + 60 * 60 * 1000)));

  React.useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('owner_id', profile?.id);

    if (data && !error) {
      setVehicles(data);
      if (data.length > 0) {
        setSelectedVehicle(data.find(v => v.is_default) || data[0]);
      }
    }
  };

  const handleCreateReservation = async () => {
    if (!selectedVehicle) {
      Alert.alert('Error', 'Please select a vehicle');
      return;
    }

    if (endTime <= startTime) {
      Alert.alert('Error', 'End time must be after start time');
      return;
    }

    if (!supabase) {
      Alert.alert('Error', 'Supabase is not configured');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reservations')
        .insert({
          customer_id: profile?.id,
          vehicle_id: selectedVehicle.id,
          slot_id: slot.id,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      Alert.alert('Success', `Reservation created: ${data.booking_code}`, [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create reservation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Create Reservation</Text>
          <Text style={styles.subtitle}>Slot {slot.slot_code}</Text>

          <View style={styles.section}>
            <Text style={styles.label}>Select Vehicle</Text>
            {vehicles.length === 0 ? (
              <Text style={styles.emptyText}>No vehicles registered</Text>
            ) : (
              vehicles.map(vehicle => (
                <TouchableOpacity
                  key={vehicle.id}
                  style={[
                    styles.vehicleOption,
                    selectedVehicle?.id === vehicle.id && styles.vehicleOptionSelected,
                  ]}
                  onPress={() => setSelectedVehicle(vehicle)}
                >
                  <Text style={styles.plateNumber}>{vehicle.plate_number}</Text>
                  <Text style={styles.vehicleType}>{vehicle.vehicle_type}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Start Time</Text>
            <TextInput
              style={styles.input}
              value={startTextInput}
              onChangeText={setStartTextInput}
              placeholder="HH:MM AM/PM"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>End Time</Text>
            <TextInput
              style={styles.input}
              value={endTextInput}
              onChangeText={setEndTextInput}
              placeholder="HH:MM AM/PM"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreateReservation}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating...' : 'Create Reservation'}
            </Text>
          </TouchableOpacity>
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
  content: {
    flex: 1,
    padding: spacing.lg,
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
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    padding: spacing.md,
  },
  vehicleOption: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  vehicleOptionSelected: {
    borderColor: colors.accent,
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
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
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
});
