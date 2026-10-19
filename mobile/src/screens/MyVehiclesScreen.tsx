import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Vehicle } from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import AppScreen from '../components/AppScreen';
import VehicleFormSheet, { VehicleFormValues } from '../components/VehicleFormSheet';
import {
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  StatusChip,
  useToast,
} from '../components/ui';
import { spacing, type as typeToken } from '../theme/tokens';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  setDefaultVehicle,
  updateVehicle,
  vehicleErrorMessage,
} from '../services/vehicles';

type SheetState = { mode: 'add' } | { mode: 'edit'; vehicle: Vehicle } | null;

/**
 * "My vehicles": list, add, edit, delete and set the default vehicle.
 * Deleting is blocked while the vehicle has an active reservation, and a
 * vehicle with booking history is archived rather than destroyed.
 */
export default function MyVehiclesScreen() {
  const navigation = useNavigation();
  const { profile } = useAuth();
  const { colors, textScale } = useTheme();
  const { showToast } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ownerId = profile?.id ?? null;

  const load = useCallback(async () => {
    if (!ownerId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setVehicles(await listVehicles(ownerId));
    } catch (error) {
      console.warn('[vehicles] could not load vehicles:', vehicleErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (values: VehicleFormValues) => {
    if (!ownerId) throw new Error('Please sign in again.');

    if (sheet?.mode === 'edit') {
      await updateVehicle(sheet.vehicle.id, {
        plateNumber: values.plateNumber,
        vehicleType: values.vehicleType,
      });
      showToast('Vehicle updated.', 'success');
    } else {
      await createVehicle({
        ownerId,
        plateNumber: values.plateNumber,
        vehicleType: values.vehicleType,
      });
      showToast('Vehicle added.', 'success');
    }

    setSheet(null);
    await load();
  };

  const handleSetDefault = async (vehicle: Vehicle) => {
    if (!ownerId) return;
    try {
      await setDefaultVehicle(ownerId, vehicle.id);
      await load();
      showToast(`${vehicle.plate_number} is now your default vehicle.`, 'success');
    } catch (error) {
      showToast(vehicleErrorMessage(error), 'error');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const result = await deleteVehicle(pendingDelete.id);
      setPendingDelete(null);
      await load();
      showToast(
        result === 'archived'
          ? 'Vehicle removed. Its past bookings are kept.'
          : 'Vehicle removed.',
        'success'
      );
    } catch (error) {
      setDeleteError(vehicleErrorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  const header = <ScreenHeader title="My vehicles" onBack={() => navigation.goBack()} />;

  if (loading) {
    return (
      <AppScreen header={header} scroll={false}>
        <SkeletonList rows={3} />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={header}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <SectionHeader title="Registered vehicles" />
      {vehicles.length === 0 ? (
        <Card>
          <EmptyState
            icon="car-sport-outline"
            title="No vehicle yet"
            message="Add a vehicle so we can assign a bay to it when you reserve."
            actionLabel="Add vehicle"
            onAction={() => setSheet({ mode: 'add' })}
          />
        </Card>
      ) : (
        vehicles.map((vehicle) => (
          <Card key={vehicle.id} style={styles.vehicleCard}>
            <View style={styles.vehicleTop}>
              <Ionicons name="car-outline" size={22} color={colors.tealDark} />
              <View style={styles.flexText}>
                <Text style={[typeToken('title', textScale), { color: colors.text }]}>
                  {vehicle.plate_number}
                </Text>
                <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                  {vehicle.vehicle_type}
                </Text>
              </View>
              {vehicle.is_default ? <StatusChip label="Default" tone="success" /> : null}
            </View>

            <View style={styles.actions}>
              {!vehicle.is_default ? (
                <Button
                  label="Set default"
                  variant="secondary"
                  icon="star-outline"
                  onPress={() => handleSetDefault(vehicle)}
                  style={styles.action}
                  accessibilityHint="Makes this the vehicle pre-selected when you reserve."
                />
              ) : null}
              <Button
                label="Edit"
                variant="ghost"
                icon="create-outline"
                onPress={() => setSheet({ mode: 'edit', vehicle })}
                style={styles.action}
              />
              <Button
                label="Delete"
                variant="danger"
                icon="trash-outline"
                onPress={() => {
                  setDeleteError(null);
                  setPendingDelete(vehicle);
                }}
                style={styles.action}
              />
            </View>
          </Card>
        ))
      )}

      {vehicles.length > 0 ? (
        <Button
          label="Add vehicle"
          icon="add"
          variant="secondary"
          onPress={() => setSheet({ mode: 'add' })}
          style={styles.addButton}
        />
      ) : null}

      <VehicleFormSheet
        visible={!!sheet}
        title={sheet?.mode === 'edit' ? 'Edit vehicle' : 'Add vehicle'}
        submitLabel={sheet?.mode === 'edit' ? 'Save changes' : 'Add vehicle'}
        initialValues={
          sheet?.mode === 'edit'
            ? { plateNumber: sheet.vehicle.plate_number, vehicleType: sheet.vehicle.vehicle_type }
            : undefined
        }
        onClose={() => setSheet(null)}
        onSubmit={handleSubmit}
      />

      <BottomSheet
        visible={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        dismissible={!deleteBusy}
        title={pendingDelete ? `Delete ${pendingDelete.plate_number}?` : undefined}
        description="A vehicle with an active reservation cannot be deleted. Past bookings are always kept."
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setPendingDelete(null)}
              disabled={deleteBusy}
              style={styles.sheetButton}
            />
            <Button
              label="Delete"
              variant="danger"
              onPress={confirmDelete}
              loading={deleteBusy}
              style={styles.sheetButton}
            />
          </>
        }
      >
        {deleteError ? (
          <View style={styles.alertRow}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.danger }]}>
              {deleteError}
            </Text>
          </View>
        ) : null}
      </BottomSheet>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flexText: {
    flex: 1,
  },
  vehicleCard: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  vehicleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  action: {
    flexGrow: 1,
    flexBasis: 96,
  },
  addButton: {
    marginTop: spacing.sm,
  },
  sheetButton: {
    flex: 1,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
