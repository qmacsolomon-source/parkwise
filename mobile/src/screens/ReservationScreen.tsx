import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { FloorPlanSlot, Rate, Vehicle, supabase } from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import { useFloorPlan } from '../hooks/useFloorPlan';
import AppScreen from '../components/AppScreen';
import FloorPlanPicker from '../components/FloorPlanPicker';
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
import {
  AssignSlotResult,
  BookingLimits,
  DEFAULT_BOOKING_LIMITS,
  WindowSuggestion,
  assignSlotForReservation,
  changeReservationSlot,
  effectiveMaxAdvanceHours,
  estimateCharge,
  fetchLatestRate,
  formatAdvanceLimit,
  formatDate,
  formatTime,
  formatWindow,
  formatDuration,
  getBookingLimits,
  hoursBetween,
  suggestNearbyWindows,
  toBookingError,
  validateWindow,
} from '../services/booking';
import VehicleFormSheet, { VehicleFormValues } from '../components/VehicleFormSheet';
import {
  createVehicle,
  listVehicles,
  vehicleErrorMessage,
} from '../services/vehicles';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';

type Step = 'form' | 'finding' | 'result';
type PickerState = { field: 'start' | 'end'; mode: 'date' | 'time' } | null;

const UNAVAILABLE_REASON: Record<string, string> = {
  reserved: 'Already booked for this time window.',
  mine: 'This is already your bay.',
  maintenance: 'Closed for maintenance.',
  pwd_locked: 'PWD bays open only to verified PWD accounts.',
};

/** Rounds up to the next quarter hour, so the default is never "now". */
function defaultStart(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  return date;
}

function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + 60 * 60 * 1000);
}

function formatMoney(amount: number): string {
  return `₱${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * PHASE 3 booking flow: vehicle -> window -> "Find my slot" -> the server
 * assigns the best free bay -> result with the plan, the route and the written
 * directions, then "Change slot" or "Done".
 */
export default function ReservationScreen() {
  const navigation = useNavigation();
  const { profile } = useAuth();
  const { colors, textScale } = useTheme();
  const { showToast } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [rate, setRate] = useState<Rate | null>(null);
  /** Set only when the rates table could not be read at all. */
  const [rateError, setRateError] = useState<string | null>(null);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);

  const [start, setStart] = useState<Date>(() => defaultStart());
  const [end, setEnd] = useState<Date>(() => defaultEnd(defaultStart()));
  const [picker, setPicker] = useState<PickerState>(null);

  const [step, setStep] = useState<Step>('form');
  const [result, setResult] = useState<AssignSlotResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<WindowSuggestion[]>([]);

  const [changing, setChanging] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<FloorPlanSlot | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const [bookingLimits, setBookingLimits] = useState<BookingLimits>(DEFAULT_BOOKING_LIMITS);

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // --- initial data -------------------------------------------------------
  // Kept as a callback so the list, the default vehicle and the rate can be
  // re-read after a vehicle is added without leaving the screen.
  const loadVehicles = useCallback(async () => {
    if (!supabase || !profile?.id) {
      setVehiclesLoading(false);
      return;
    }

    try {
      const [list, lookup] = await Promise.all([
        listVehicles(profile.id),
        fetchLatestRate(),
      ]);

      setVehicles(list);
      setRate(lookup.rate);
      setRateError(lookup.error);
      setVehicleId((current) => {
        if (current && list.some((vehicle) => vehicle.id === current)) return current;
        return list.find((vehicle) => vehicle.is_default)?.id ?? list[0]?.id ?? null;
      });
    } catch (error) {
      console.warn('[reserve] could not load vehicles:', vehicleErrorMessage(error));
    } finally {
      setVehiclesLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    setVehiclesLoading(true);
    void loadVehicles();
  }, [loadVehicles]);

  // How far ahead booking currently reaches, lot-wide - same reasoning as
  // the Dashboard notice: booking_limits_cache is public-read and kept
  // current by database triggers, so this stays live across every
  // customer's activity, not just a refetch of this one's own reservations.
  useEffect(() => {
    void getBookingLimits().then(setBookingLimits);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('reserve-booking-limits')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'booking_limits_cache' },
        (payload) => {
          const row = payload.new as { pwd_max_hours: number; regular_max_hours: number };
          setBookingLimits({
            pwdMaxHours: Number(row.pwd_max_hours),
            regularMaxHours: Number(row.regular_max_hours),
          });
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, []);

  /** Adds a vehicle from the Reserve empty state, then refreshes the list. */
  const handleAddVehicle = async (values: VehicleFormValues) => {
    if (!profile?.id) throw new Error('Please sign in again.');

    const vehicle = await createVehicle({
      ownerId: profile.id,
      plateNumber: values.plateNumber,
      vehicleType: values.vehicleType,
    });

    await loadVehicles();
    setVehicleId(vehicle.id);
    setAddVehicleOpen(false);
    showToast(`${vehicle.plate_number} added.`, 'success');
  };

  // --- the plan for the window we are looking at --------------------------
  const planStart = result?.start_time ?? startISO;
  const planEnd = result?.end_time ?? endISO;
  const plan = useFloorPlan({
    start: planStart,
    end: planEnd,
    enabled: step === 'result' || changing,
    realtime: step === 'result' || changing,
  });

  const effectiveAdvanceHours = useMemo(
    () => effectiveMaxAdvanceHours(bookingLimits, !!profile?.pwd_verified),
    [bookingLimits, profile?.pwd_verified]
  );
  const fullyBooked = effectiveAdvanceHours <= 0;

  const windowError = validateWindow(startISO, endISO, new Date(), effectiveAdvanceHours);
  const charge = estimateCharge(startISO, endISO, rate?.hourly_rate ?? null);
  const noSlotAvailable = !!formError && formError.includes('Every bay is taken');

  // --- pickers ------------------------------------------------------------
  const applyToField = useCallback(
    (field: 'start' | 'end', next: Date) => {
      if (field === 'start') {
        setStart(next);
        // Keep at least an hour of parking when the start moves past the end.
        if (next.getTime() >= end.getTime()) setEnd(defaultEnd(next));
      } else {
        setEnd(next);
      }
    },
    [end]
  );

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    const active = picker;
    setPicker(null);
    if (!active || event.type === 'dismissed' || !value) return;

    const base = active.field === 'start' ? start : end;
    const next = new Date(base);

    if (active.mode === 'date') {
      next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
    } else {
      next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    }

    applyToField(active.field, next);
  };

  // --- the booking itself -------------------------------------------------
  const findSlot = async () => {
    if (!vehicleId) {
      setFormError('Choose which vehicle you are parking first.');
      return;
    }

    const problem = validateWindow(startISO, endISO, new Date(), effectiveAdvanceHours);
    if (problem) {
      setFormError(problem);
      return;
    }

    setFormError(null);
    setSuggestions([]);
    setStep('finding');

    try {
      const assigned = await assignSlotForReservation(vehicleId, startISO, endISO);
      setResult(assigned);
      setStep('result');
      showToast(`Slot ${assigned.slot_code} is yours.`, 'success');
    } catch (error) {
      const bookingError = toBookingError(error);
      setFormError(bookingError.message);
      setStep('form');
      showToast(bookingError.message, bookingError.code === 'NO_SLOT_AVAILABLE' ? 'info' : 'error');

      if (bookingError.code === 'NO_SLOT_AVAILABLE') {
        suggestNearbyWindows(startISO, endISO)
          .then(setSuggestions)
          .catch(() => undefined);
      }
    }
  };

  const applySuggestion = (suggestion: WindowSuggestion) => {
    setStart(new Date(suggestion.start));
    setEnd(new Date(suggestion.end));
    setFormError(null);
    setSuggestions([]);
  };

  // --- changing the slot --------------------------------------------------
  const handleSlotTap = (slot: FloorPlanSlot) => {
    if (slot.availability !== 'available') {
      const reason = UNAVAILABLE_REASON[slot.availability] ?? 'Not available for this window.';
      showToast(`${slot.slot_code}: ${reason}`, 'info');
      return;
    }

    setChangeError(null);
    setPendingSlot(slot);
  };

  const confirmChange = async () => {
    if (!result || !pendingSlot) return;

    setChangeBusy(true);
    setChangeError(null);

    try {
      const updated = await changeReservationSlot(result.reservation_id, pendingSlot.slot_id);
      setResult((previous) => (previous ? { ...previous, ...updated } : previous));
      setPendingSlot(null);
      setChanging(false);
      showToast(`Moved to slot ${updated.slot_code}.`, 'success');
      await plan.refresh();
    } catch (error) {
      const bookingError = toBookingError(error);
      setChangeError(bookingError.message);
      showToast(bookingError.message, 'error');
      if (bookingError.code === 'SLOT_TAKEN') await plan.refresh();
    } finally {
      setChangeBusy(false);
    }
  };

  const goHome = () => navigation.navigate('Dashboard' as never);

  // --- render -------------------------------------------------------------
  const header = (
    <ScreenHeader
      hero
      title={step === 'result' ? 'Booking confirmed' : 'Reserve'}
      subtitle={
        step === 'result'
          ? 'Here is where to park.'
          : 'Tell us when, and we will assign the closest free bay.'
      }
      onBack={step === 'result' ? goHome : undefined}
    />
  );

  if (step === 'finding') {
    return (
      <AppScreen header={header} tab="Reserve" scroll={false}>
        <View style={styles.finding}>
          <ActivityIndicator size="large" color={colors.teal} />
          <Text style={[typeToken('subtitle', textScale), { color: colors.text }]}>
            Finding the best slot for you…
          </Text>
          <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
            Checking every floor for the bay closest to the entrance.
          </Text>
          <View style={styles.findingSkeleton}>
            <SkeletonList rows={2} />
          </View>
        </View>
      </AppScreen>
    );
  }

  if (step === 'result' && result) {
    return (
      <AppScreen header={header} tab="Reserve" scroll refreshing={plan.loading} onRefresh={plan.refresh}>
        <Card style={styles.confirmCard}>
          <StatusChip label="Slot assigned" tone="success" />
          <Text style={[typeToken('caption', textScale), styles.confirmLabel, { color: colors.textMuted }]}>
            BOOKING CODE
          </Text>
          <Text style={[typeToken('display', textScale), { color: colors.text }]}>{result.booking_code}</Text>

          <View style={styles.confirmRow}>
            <Ionicons name="car-outline" size={18} color={colors.tealDark} />
            <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
              Slot {result.slot_code} · Floor {result.floor}
            </Text>
          </View>
          <View style={styles.confirmRow}>
            <Ionicons name="time-outline" size={18} color={colors.tealDark} />
            <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.text }]}>
              {formatWindow(result.start_time, result.end_time)}
            </Text>
          </View>
          <View style={styles.confirmRow}>
            <Ionicons name="cash-outline" size={18} color={colors.tealDark} />
            <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.text }]}>
              Estimated {formatMoney(result.estimated_charge)} · payment is collected in cash at exit
            </Text>
          </View>
        </Card>

        {changing ? (
          <View style={styles.block}>
            <SectionHeader title="Choose a new bay" />
            <FloorPlanPicker
              slots={plan.slots}
              layout={plan.layout}
              loading={plan.loading}
              error={plan.error}
              source={plan.source}
              selectedSlotId={pendingSlot?.slot_id ?? result.slot_id}
              onSelectSlot={handleSlotTap}
              routeSlotId={result.slot_id}
            />
            <Text style={[typeToken('small', textScale), styles.footnote, { color: colors.textMuted }]}>
              Taken, closed and PWD-locked bays cannot be chosen. Tap an available bay to move your
              booking onto it.
            </Text>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setChanging(false);
                setPendingSlot(null);
                setChangeError(null);
              }}
              style={styles.blockAction}
            />
          </View>
        ) : (
          <>
            <View style={styles.block}>
              <SectionHeader title="Your route" />
              <FloorPlanPicker
                slots={plan.slots}
                layout={plan.layout}
                loading={plan.loading}
                error={plan.error}
                source={plan.source}
                selectedSlotId={result.slot_id}
                routeSlotId={result.slot_id}
              />
            </View>

            <View style={styles.actions}>
              <Button
                label="Change slot"
                variant="secondary"
                icon="swap-horizontal"
                onPress={() => setChanging(true)}
                disabled={plan.loading || plan.slots.length === 0}
              />
              <Button label="Done" icon="checkmark" onPress={goHome} />
            </View>
          </>
        )}

        <BottomSheet
          visible={!!pendingSlot}
          onClose={() => setPendingSlot(null)}
          dismissible={!changeBusy}
          title={pendingSlot ? `Move to ${pendingSlot.slot_code}?` : undefined}
          description={
            pendingSlot
              ? `Slot ${pendingSlot.slot_code} will replace ${result.slot_code} for ${formatWindow(
                  result.start_time,
                  result.end_time
                )}.`
              : undefined
          }
          footer={
            <>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setPendingSlot(null)}
                disabled={changeBusy}
                style={styles.sheetButton}
              />
              <Button
                label="Confirm"
                onPress={confirmChange}
                loading={changeBusy}
                style={styles.sheetButton}
              />
            </>
          }
        >
          {changeError ? (
            <Text style={[typeToken('body', textScale), { color: colors.danger }]}>{changeError}</Text>
          ) : null}
        </BottomSheet>
      </AppScreen>
    );
  }

  return (
    <AppScreen header={header} tab="Reserve" scroll>
      {fullyBooked ? (
        <Card style={{ borderColor: colors.danger, backgroundColor: colors.dangerTint }}>
          <View style={styles.alertRow}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.danger }]}>
              The lot is fully booked right now - every bay already has a reservation against it.
              New bookings will open up as slots clear.
            </Text>
          </View>
        </Card>
      ) : effectiveAdvanceHours < 8 ? (
        <Text style={[typeToken('small', textScale), styles.footnote, { color: colors.textMuted }]}>
          The lot is filling up, so you can currently book up to {formatAdvanceLimit(effectiveAdvanceHours)}{' '}
          ahead.
        </Text>
      ) : null}

      {/* 1. vehicle */}
      <SectionHeader title="Vehicle" />
      {vehiclesLoading ? (
        <SkeletonList rows={2} />
      ) : vehicles.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon="car-outline"
            title="No vehicle on your account"
            message="Add a vehicle first and we will assign a bay to it."
            actionLabel="Add vehicle"
            onAction={() => setAddVehicleOpen(true)}
          />
        </Card>
      ) : (
        <Card style={styles.cardTight}>
          {vehicles.map((vehicle) => {
            const selected = vehicle.id === vehicleId;
            return (
              <Pressable
                key={vehicle.id}
                onPress={() => setVehicleId(vehicle.id)}
                accessibilityRole="radio"
                accessibilityLabel={`${vehicle.plate_number}, ${vehicle.vehicle_type}${
                  vehicle.is_default ? ', default vehicle' : ''
                }`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: selected ? colors.tealDark : colors.border,
                    backgroundColor: selected ? colors.tealTint : pressed ? colors.surfaceAlt : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? colors.tealDark : colors.textMuted}
                />
                <View style={styles.flexText}>
                  <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
                    {vehicle.plate_number}
                  </Text>
                  <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                    {vehicle.vehicle_type}
                    {vehicle.is_default ? ' · default' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}

      {/* 2. window */}
      <View style={styles.block}>
        <SectionHeader title="When" />
        <Card style={styles.cardTight}>
          <TimeRow
            label="Starts"
            date={start}
            onPickDate={() => setPicker({ field: 'start', mode: 'date' })}
            onPickTime={() => setPicker({ field: 'start', mode: 'time' })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TimeRow
            label="Ends"
            date={end}
            onPickDate={() => setPicker({ field: 'end', mode: 'date' })}
            onPickTime={() => setPicker({ field: 'end', mode: 'time' })}
          />
        </Card>
      </View>

      {picker ? (
        <DateTimePicker
          value={picker.field === 'start' ? start : end}
          mode={picker.mode}
          minimumDate={picker.field === 'end' ? start : new Date()}
          maximumDate={
            picker.field === 'start' ? new Date(Date.now() + effectiveAdvanceHours * 3_600_000) : undefined
          }
          onChange={onPickerChange}
        />
      ) : null}

      {/* 3. estimate */}
      <View style={styles.block}>
        <SectionHeader title="Estimated charge" />
        <Card>
          <View style={styles.estimateRow}>
            <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>Duration</Text>
            <Text style={[typeToken('bodyStrong', textScale), { color: colors.text }]}>
              {formatDuration(startISO, endISO)}
            </Text>
          </View>
          <View style={styles.estimateRow}>
            <Text style={[typeToken('body', textScale), { color: colors.textMuted }]}>
              Rate{rate ? ` (${formatMoney(rate.hourly_rate)} / hour)` : ''}
            </Text>
            <Text style={[typeToken('title', textScale), { color: colors.text }]}>
              {rate ? formatMoney(charge) : 'Unavailable'}
            </Text>
          </View>
          {!rate ? (
            <Text
              style={[typeToken('small', textScale), { color: colors.textMuted }]}
              accessibilityLiveRegion="polite"
            >
              {rateError
                ? 'The rate table could not be read, so the estimate is unavailable. Your booking still goes through, and the attendant will compute the exact amount at exit.'
                : 'No rate is set up yet, so the estimate is unavailable. Your booking still goes through, and the attendant will compute the exact amount at exit.'}
            </Text>
          ) : null}
          <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
            {hoursBetween(startISO, endISO) > 0
              ? 'Charged in whole hours, rounded up. Payment is collected in cash at exit.'
              : ''}
          </Text>
        </Card>
      </View>

      {/* 4. no slot / problem */}
      {noSlotAvailable ? (
        <Card style={styles.block}>
          <EmptyState
            compact
            icon="car-outline"
            title="Every bay is taken for that time"
            message="Change the time and we will look again."
          />
        </Card>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.block}>
          <SectionHeader title="Times that still have a free bay" />
          <Card style={styles.cardTight}>
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.start}
                onPress={() => applySuggestion(suggestion)}
                accessibilityRole="button"
                accessibilityLabel={`Try ${formatWindow(suggestion.start, suggestion.end)}`}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  },
                ]}
              >
                <Ionicons name="time-outline" size={20} color={colors.tealDark} />
                <Text style={[typeToken('body', textScale), styles.flexText, { color: colors.text }]}>
                  {formatWindow(suggestion.start, suggestion.end)}
                </Text>
                <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                  {suggestion.freeCount} free
                </Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}

      {formError && !noSlotAvailable ? (
        <View style={styles.block}>
          <Card style={{ borderColor: colors.danger }}>
            <View style={styles.alertRow}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text
                style={[typeToken('body', textScale), styles.flexText, { color: colors.danger }]}
                accessibilityLiveRegion="polite"
              >
                {formError}
              </Text>
            </View>
          </Card>
        </View>
      ) : null}

      {windowError && !formError ? (
        <View style={styles.block}>
          <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>{windowError}</Text>
        </View>
      ) : null}

      <Button
        label="Find my slot"
        size="lg"
        icon="search"
        onPress={findSlot}
        disabled={!!windowError || !vehicleId || fullyBooked}
        accessibilityHint="Assigns the closest free bay for the chosen time"
        style={styles.cta}
      />

      <Text style={[typeToken('small', textScale), styles.footnote, { color: colors.textMuted }]}>
        {profile?.pwd_verified
          ? 'Your PWD verification is on file, so PWD bays are offered to you first.'
          : 'PWD bays stay reserved for PWD-verified customers.'}
      </Text>

      <VehicleFormSheet
        visible={addVehicleOpen}
        title="Add vehicle"
        submitLabel="Add vehicle"
        onClose={() => setAddVehicleOpen(false)}
        onSubmit={handleAddVehicle}
      />
    </AppScreen>
  );
}

interface TimeRowProps {
  label: string;
  date: Date;
  onPickDate: () => void;
  onPickTime: () => void;
}

function TimeRow({ label, date, onPickDate, onPickTime }: TimeRowProps) {
  const { colors, textScale } = useTheme();

  return (
    <View style={styles.timeRow}>
      <Text style={[typeToken('body', textScale), styles.timeLabel, { color: colors.textMuted }]}>
        {label}
      </Text>

      <Pressable
        onPress={onPickDate}
        accessibilityRole="button"
        accessibilityLabel={`${label} date: ${formatDate(date.toISOString())}`}
        style={({ pressed }) => [
          styles.timeButton,
          { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
        ]}
      >
        <Ionicons name="calendar-outline" size={16} color={colors.tealDark} />
        <Text style={[typeToken('body', textScale), { color: colors.text }]}>
          {formatDate(date.toISOString())}
        </Text>
      </Pressable>

      <Pressable
        onPress={onPickTime}
        accessibilityRole="button"
        accessibilityLabel={`${label} time: ${formatTime(date.toISOString())}`}
        style={({ pressed }) => [
          styles.timeButton,
          { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
        ]}
      >
        <Ionicons name="time-outline" size={16} color={colors.tealDark} />
        <Text style={[typeToken('body', textScale), { color: colors.text }]}>
          {formatTime(date.toISOString())}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flexText: {
    flex: 1,
  },
  cardTight: {
    paddingVertical: spacing.xs,
  },
  block: {
    marginTop: spacing.lg,
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
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    flexWrap: 'wrap',
  },
  timeLabel: {
    width: 52,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cta: {
    marginTop: spacing.lg,
  },
  footnote: {
    marginTop: spacing.sm,
  },
  finding: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.screen,
  },
  findingSkeleton: {
    width: '100%',
    marginTop: spacing.lg,
  },
  confirmCard: {
    marginTop: spacing.md,
    gap: spacing.xxs,
  },
  confirmLabel: {
    marginTop: spacing.xs,
    letterSpacing: 0.6,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  blockAction: {
    marginTop: spacing.sm,
  },
  sheetButton: {
    flex: 1,
  },
});
