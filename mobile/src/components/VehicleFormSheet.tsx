import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/AccessibilityContext';
import { BottomSheet, Button, TextField } from './ui';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';
import {
  DEFAULT_VEHICLE_TYPE,
  VEHICLE_TYPES,
  normalizePlate,
  plateError,
  vehicleErrorMessage,
} from '../services/vehicles';

export interface VehicleFormValues {
  plateNumber: string;
  vehicleType: string;
}

interface Props {
  visible: boolean;
  title: string;
  submitLabel: string;
  initialValues?: VehicleFormValues;
  onClose: () => void;
  /** Rejecting the promise keeps the sheet open and shows the message. */
  onSubmit: (values: VehicleFormValues) => Promise<void>;
}

/**
 * Add / edit a vehicle: plate number (3 letters + 3 or 4 digits) plus a
 * four-wheeled body type. Used by the Reserve empty state and My vehicles.
 */
export default function VehicleFormSheet({
  visible,
  title,
  submitLabel,
  initialValues,
  onClose,
  onSubmit,
}: Props) {
  const { colors, textScale } = useTheme();
  const [plate, setPlate] = useState(initialValues?.plateNumber ?? '');
  const [vehicleType, setVehicleType] = useState(initialValues?.vehicleType ?? DEFAULT_VEHICLE_TYPE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed every time the sheet opens so a cancelled edit never leaks.
  useEffect(() => {
    if (!visible) return;
    setPlate(initialValues?.plateNumber ?? '');
    setVehicleType(initialValues?.vehicleType ?? DEFAULT_VEHICLE_TYPE);
    setError(null);
    setBusy(false);
  }, [visible, initialValues?.plateNumber, initialValues?.vehicleType]);

  const handleSubmit = async () => {
    const problem = plateError(plate);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit({ plateNumber: normalizePlate(plate), vehicleType });
    } catch (submitError) {
      setError(vehicleErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description="Only four-wheeled vehicles can be registered."
      footer={
        <>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={onClose}
            disabled={busy}
            style={styles.sheetButton}
          />
          <Button
            label={submitLabel}
            onPress={handleSubmit}
            loading={busy}
            style={styles.sheetButton}
          />
        </>
      }
    >
      <TextField
        label="Plate number"
        value={plate}
        onChangeText={(text) => setPlate(text.toUpperCase())}
        placeholder="ABC1234"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        editable={!busy}
        leadingIcon="car-outline"
        invalid={!!error}
        message={error ?? '3 letters + 3 or 4 numbers (e.g. ABC123 or ABC1234).'}
      />

      <Text style={[typeToken('bodyStrong', textScale), styles.groupLabel, { color: colors.text }]}>
        Vehicle type
      </Text>
      <View accessibilityRole="radiogroup">
        {VEHICLE_TYPES.map((option) => {
          const selected = option.value === vehicleType;
          return (
            <Pressable
              key={option.value}
              onPress={() => setVehicleType(option.value)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: selected ? colors.tealDark : colors.border,
                  backgroundColor: selected
                    ? colors.tealTint
                    : pressed
                      ? colors.surfaceAlt
                      : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.tealDark : colors.textMuted}
              />
              <Text style={[typeToken('body', textScale), { color: colors.text }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginVertical: 3,
  },
  sheetButton: {
    flex: 1,
  },
});
