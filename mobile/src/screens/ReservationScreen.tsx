import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, DateTimePicker } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot, Vehicle, Reservation } from '@parkwise/shared';
import { colors, spacing, borderRadius, fontSize } from '../theme';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function ReservationScreen() {
  const { profile } = useAuth();
  const navigation = useNavigation();
  const route = useRoute();
  const { slot } = route.params as { slot: Slot };

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 60 * 60 * 1000)); // 1 hour from now
  const [loading, setLoading] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  React.useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
            <TouchableOpacity
              style={styles.timeButton}
              onPress={() => setShowStartPicker(true)}
            >
              <Text style={styles.timeText}>
                {formatDate(startTime)} at {formatTime(startTime)}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>End Time</Text>
            <TouchableOpacity
              style={styles.timeButton}
              onPress={() => setShowEndPicker(true)}
            >
              <Text style={styles.timeText}>
                {formatDate(endTime)} at {formatTime(endTime)}
              </Text>
            </TouchableOpacity>
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

      <Modal
        visible={showStartPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStartPicker(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={styles.pickerContent}>
            <DateTimePicker
              value={startTime}
              mode="datetime"
              onChange={(event, date) => {
                setShowStartPicker(false);
                if (date) setStartTime(date);
              }}
            />
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowStartPicker(false)}
            >
              <Text style={styles.pickerButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEndPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEndPicker(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={styles.pickerContent}>
            <DateTimePicker
              value={endTime}
              mode="datetime"
              onChange={(event, date) => {
                setShowEndPicker(false);
                if (date) setEndTime(date);
              }}
            />
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowEndPicker(false)}
            >
              <Text style={styles.pickerButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  timeButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeText: {
    fontSize: fontSize.md,
    color: colors.text,
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
  pickerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  pickerButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  pickerButtonText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
});
