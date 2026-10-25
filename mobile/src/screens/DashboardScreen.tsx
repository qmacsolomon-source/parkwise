import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { AgentState, Penalty, Reservation, Vehicle, supabase } from '@parkwise/shared';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/AccessibilityContext';
import AppScreen from '../components/AppScreen';
import {
  Button,
  Card,
  EmptyState,
  ListRow,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  StatusChip,
  useToast,
} from '../components/ui';
import {
  BookingLimits,
  DEFAULT_BOOKING_LIMITS,
  effectiveMaxAdvanceHours,
  formatAdvanceLimit,
  formatDuration,
  formatTime,
  formatWindow,
  getBookingLimits,
} from '../services/booking';
import { radius, spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';

type RootStackParamList = {
  Dashboard: undefined;
  Reservation: undefined;
  Timer: undefined;
  Wayfinding: {
    reservationId?: string;
    slotId?: string;
    slotCode?: string;
    start?: string;
    end?: string;
  };
  Notifications: undefined;
  History: undefined;
  Settings: undefined;
  MyVehicles: undefined;
  Help: undefined;
};

/** A booking that still matters: not finished, not cancelled. */
const OPEN_STATUSES = ['pending', 'active', 'verified', 'overstay'];

interface SlotInfo {
  slot_code: string;
  floor: number;
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(amount: number): string {
  return `₱${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface QuickAction {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route: keyof RootStackParamList;
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'reserve', label: 'Reserve', icon: 'add-circle-outline', route: 'Reservation' },
  { key: 'timer', label: 'Timer', icon: 'timer-outline', route: 'Timer' },
  { key: 'alerts', label: 'Alerts', icon: 'notifications-outline', route: 'Notifications' },
  { key: 'help', label: 'Help', icon: 'help-circle-outline', route: 'Help' },
];

/**
 * Home. A greeting, the live booking card with "Show me the way", quick
 * actions and a penalty warning when one is outstanding. The old
 * horizontally-scrolling "Available Slots" list is gone -- bays are chosen on
 * the floor plan in the Reserve flow, never from a scroller here.
 */
export default function DashboardScreen() {
  const { profile, user } = useAuth();
  const { colors, textScale } = useTheme();
  const { showToast } = useToast();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [slotInfo, setSlotInfo] = useState<Record<string, SlotInfo>>({});
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(() => Date.now());

  // Lot-wide, not per-customer - everyone competing for the same bays sees
  // the same shrinking window. Plain useState on purpose: this notice
  // dismisses for the session and reappears on the next cold launch, it
  // never persists to storage.
  const [bookingLimits, setBookingLimits] = useState<BookingLimits>(DEFAULT_BOOKING_LIMITS);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Read inside the realtime callback, which must not re-subscribe per render.
  const reservationsRef = useRef<Reservation[]>([]);
  useEffect(() => {
    reservationsRef.current = reservations;
  }, [reservations]);

  const loadData = useCallback(async () => {
    if (!supabase || !profile?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [reservationsResult, vehiclesResult, penaltiesResult] = await Promise.all([
        supabase
          .from('reservations')
          .select('*')
          .eq('customer_id', profile.id)
          .order('start_time', { ascending: false }),
        supabase.from('vehicles').select('*').eq('owner_id', profile.id).eq('is_active', true),
        supabase.from('penalties').select('*').eq('customer_id', profile.id).eq('status', 'unpaid'),
      ]);

      if (reservationsResult.error) {
        console.warn('[home] could not load reservations:', reservationsResult.error.message);
      }

      const list = (reservationsResult.data ?? []) as Reservation[];
      setReservations(list);
      setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
      setPenalties((penaltiesResult.data ?? []) as Penalty[]);

      // reservations only carry slot_id, so resolve the readable code once.
      const slotIds = Array.from(new Set(list.map((row) => row.slot_id).filter(Boolean)));
      if (slotIds.length > 0) {
        const { data } = await supabase.from('slots').select('id, slot_code, floor').in('id', slotIds);
        const next: Record<string, SlotInfo> = {};
        for (const row of (data ?? []) as { id: string; slot_code: string; floor: number }[]) {
          next[row.id] = { slot_code: row.slot_code, floor: row.floor };
        }
        setSlotInfo(next);
      }
    } catch (error) {
      console.warn('[home] could not load data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // How far ahead booking currently reaches, lot-wide. booking_limits_cache
  // is public-read and kept current by database triggers, so subscribing to
  // IT (rather than `reservations`, which RLS would hide other customers'
  // rows from) reaches this live across every customer, not just this one's
  // own activity.
  useEffect(() => {
    void getBookingLimits().then(setBookingLimits);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('home-booking-limits')
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

  // A minute-resolution countdown: the Timer screen is the one that ticks.
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const announceSlotChange = useCallback(
    async (slotId: string) => {
      let code: string | null = null;
      if (supabase) {
        try {
          const { data } = await supabase
            .from('slots')
            .select('id, slot_code, floor')
            .eq('id', slotId)
            .maybeSingle();
          if (data) {
            const row = data as { id: string; slot_code: string; floor: number };
            code = row.slot_code;
            setSlotInfo((previous) => ({
              ...previous,
              [row.id]: { slot_code: row.slot_code, floor: row.floor },
            }));
          }
        } catch {
          code = null;
        }
      }

      showToast(
        code
          ? `The counter moved your booking to slot ${code}.`
          : 'The counter changed the slot on your booking.',
        'info'
      );
    },
    [showToast]
  );

  // Live updates: if an attendant reassigns the bay on the desktop the card
  // follows along and we tell the customer.
  useEffect(() => {
    if (!supabase || !profile?.id) return;

    const channel = supabase
      .channel('home-reservations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `customer_id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old as { id?: string };
            if (removed?.id) {
              setReservations((previous) => previous.filter((row) => row.id !== removed.id));
            }
            return;
          }

          const next = payload.new as Reservation;
          const previous = reservationsRef.current.find((row) => row.id === next.id);
          const isNew = !previous;

          setReservations((current) =>
            current.some((row) => row.id === next.id)
              ? current.map((row) => (row.id === next.id ? next : row))
              : [next, ...current]
          );

          if (previous && previous.slot_id !== next.slot_id) {
            void announceSlotChange(next.slot_id);
          } else if (isNew) {
            showToast(`Booking ${next.booking_code} confirmed.`, 'success');
          }
        }
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, [announceSlotChange, profile?.id, showToast]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const now = tick;

  const activeReservation = useMemo(() => {
    return (
      reservations
        .filter(
          (row) =>
            OPEN_STATUSES.includes(row.status) &&
            // Overstay means end_time has already passed by definition -
            // excluding it here would hide the hero card (and "Show me the
            // way") at the exact moment an overstaying customer most needs
            // it, right alongside the status list missing 'overstay' at all.
            (row.status === 'overstay' || new Date(row.end_time).getTime() > now)
        )
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0] ?? null
    );
  }, [now, reservations]);

  const activeSlot = activeReservation ? slotInfo[activeReservation.slot_id] ?? null : null;

  const recentReservations = useMemo(() => reservations.slice(0, 2), [reservations]);

  const effectiveAdvanceHours = useMemo(
    () => effectiveMaxAdvanceHours(bookingLimits, !!profile?.pwd_verified),
    [bookingLimits, profile?.pwd_verified]
  );

  const advanceNotice = useMemo(() => {
    if (effectiveAdvanceHours <= 0) {
      return {
        tone: 'danger' as const,
        title: 'The lot is fully booked',
        message: 'Every bay already has a reservation against it. New bookings will open up as slots clear.',
      };
    }
    if (effectiveAdvanceHours < 8) {
      return {
        tone: 'warning' as const,
        title: 'Advance booking is limited',
        message: `The lot is filling up, so you can currently book up to ${formatAdvanceLimit(
          effectiveAdvanceHours
        )} ahead.`,
      };
    }
    return {
      tone: 'info' as const,
      title: 'Advance booking is open',
      message: `You can currently book up to ${formatAdvanceLimit(effectiveAdvanceHours)} ahead.`,
    };
  }, [effectiveAdvanceHours]);

  const noticeColors = {
    danger: { border: colors.danger, tint: colors.dangerTint },
    warning: { border: colors.warning, tint: colors.warningTint },
    info: { border: colors.info, tint: colors.infoTint },
  }[advanceNotice.tone];

  const unpaidTotal = useMemo(
    () => penalties.reduce((sum, penalty) => sum + (Number(penalty.amount) || 0), 0),
    [penalties]
  );

  // The profile row can be missing (older sign-ups); fall back to the local
  // part of the session email so the greeting is never blank.
  const firstName =
    profile?.first_name ||
    (profile?.full_name ?? '').trim().split(' ')[0] ||
    (user?.email ?? '').split('@')[0] ||
    '';
  const ongoing = activeReservation
    ? new Date(activeReservation.start_time).getTime() <= now
    : false;

  // Live camera check: only while the booking is actually ongoing (the
  // attendant's "Accept Vehicle" is what starts frames being saved for a
  // slot at all - before that, or once the booking's over, there is nothing
  // to show). RLS (14_customer_agent_state_read.sql) scopes this to the
  // customer's own slot, so this can never read another customer's frame.
  useEffect(() => {
    if (!supabase || !activeReservation || !ongoing) {
      setAgentState(null);
      return;
    }

    const slotId = activeReservation.slot_id;
    let isCurrent = true;

    void supabase
      .from('agent_states')
      .select('*')
      .eq('slot_id', slotId)
      .maybeSingle()
      .then(({ data }) => {
        if (isCurrent) setAgentState((data as AgentState | null) ?? null);
      });

    const channel = supabase
      .channel(`home-agent-state-${slotId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_states', filter: `slot_id=eq.${slotId}` },
        (payload) => {
          setAgentState(payload.eventType === 'DELETE' ? null : (payload.new as AgentState));
        }
      )
      .subscribe();

    return () => {
      isCurrent = false;
      void channel.unsubscribe();
    };
  }, [activeReservation?.slot_id, ongoing]);

  const countdownLabel = activeReservation
    ? ongoing
      ? `${formatDuration(new Date(now).toISOString(), activeReservation.end_time)} left`
      : `Starts in ${formatDuration(new Date(now).toISOString(), activeReservation.start_time)}`
    : '';

  const openWayfinding = () => {
    if (!activeReservation) return;
    navigation.navigate('Wayfinding', {
      reservationId: activeReservation.id,
      slotId: activeReservation.slot_id,
      slotCode: activeSlot?.slot_code,
      start: activeReservation.start_time,
      end: activeReservation.end_time,
    });
  };

  const header = (
    <ScreenHeader
      hero
      title={firstName ? `Hi, ${firstName}` : 'Welcome back'}
      subtitle="Where are you parking today?"
      actionIcon="notifications-outline"
      actionLabel="Notifications"
      onAction={() => navigation.navigate('Notifications')}
    />
  );

  if (loading) {
    return (
      <AppScreen header={header} tab="Home" scroll={false}>
        <SkeletonList rows={4} />
      </AppScreen>
    );
  }

  return (
    <AppScreen header={header} tab="Home" refreshing={refreshing} onRefresh={onRefresh}>
      {!noticeDismissed ? (
        <Card
          style={{
            ...styles.block,
            borderColor: noticeColors.border,
            backgroundColor: noticeColors.tint,
          }}
        >
          <View style={styles.warningRow}>
            <Ionicons
              name={advanceNotice.tone === 'info' ? 'information-circle' : 'alert-circle'}
              size={22}
              color={noticeColors.border}
            />
            <View style={styles.flexText}>
              <Text style={[typeToken('bodyStrong', textScale), { color: noticeColors.border }]}>
                {advanceNotice.title}
              </Text>
              <Text style={[typeToken('small', textScale), { color: noticeColors.border }]}>
                {advanceNotice.message}
              </Text>
            </View>
            <Pressable
              onPress={() => setNoticeDismissed(true)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={noticeColors.border} />
            </Pressable>
          </View>
        </Card>
      ) : null}

      {penalties.length > 0 ? (
        <Card
          style={{
            ...styles.block,
            borderColor: colors.danger,
            backgroundColor: colors.dangerTint,
          }}
        >
          <View style={styles.warningRow}>
            <Ionicons name="alert-circle" size={22} color={colors.danger} />
            <View style={styles.flexText}>
              <Text style={[typeToken('bodyStrong', textScale), { color: colors.danger }]}>
                {penalties.length === 1 ? 'You have an unpaid penalty' : 'You have unpaid penalties'}
              </Text>
              <Text style={[typeToken('small', textScale), { color: colors.danger }]}>
                {formatMoney(unpaidTotal)} outstanding. Please settle it at the attendant counter
                before booking a new slot.
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <View style={styles.block}>
        <SectionHeader title="Your booking" />
        {activeReservation ? (
          <Card
            style={{
              ...styles.heroCard,
              backgroundColor: colors.navy,
              borderColor: colors.navy,
            }}
          >
            <View style={styles.heroTop}>
              <StatusChip
                label={ongoing ? 'Parking now' : 'Upcoming'}
                tone={ongoing ? 'warning' : 'info'}
              />
              <Text style={[typeToken('caption', textScale), { color: colors.tealTint }]}>
                {activeReservation.booking_code}
              </Text>
            </View>

            <View style={styles.heroSlotRow}>
              <Ionicons name="car" size={28} color={colors.tealTint} />
              <Text style={[typeToken('display', textScale), { color: colors.textOnDark }]}>
                {activeSlot ? activeSlot.slot_code : 'Slot assigned'}
              </Text>
              {activeSlot ? (
                <Text style={[typeToken('caption', textScale), { color: colors.tealTint }]}>
                  Floor {activeSlot.floor}
                </Text>
              ) : null}
            </View>

            <Text style={[typeToken('body', textScale), { color: colors.tealTint }]}>
              {formatWindow(activeReservation.start_time, activeReservation.end_time)}
            </Text>

            <Text style={[typeToken('title', textScale), styles.countdown, { color: colors.textOnDark }]}>
              {countdownLabel}
            </Text>

            {ongoing && agentState?.last_frame_url ? (
              <View style={styles.cameraCheck}>
                <Image
                  source={{ uri: agentState.last_frame_url }}
                  style={styles.cameraCheckImage}
                  resizeMode="cover"
                />
                <Text style={[typeToken('caption', textScale), { color: colors.tealTint }]}>
                  Live camera check - updated {formatTime(agentState.updated_at)}
                </Text>
              </View>
            ) : null}

            <View style={styles.heroActions}>
              <Button
                label="Show me the way"
                icon="navigate"
                onPress={openWayfinding}
                style={styles.heroButton}
              />
              <Button
                label="Timer"
                variant="ghost"
                icon="timer-outline"
                onPress={() => navigation.navigate('Timer')}
                style={styles.heroButton}
              />
            </View>
          </Card>
        ) : (
          <Card>
            <EmptyState
              compact
              icon="car-outline"
              title="No active booking"
              message="Reserve a bay and we will show you the way from the entrance to your slot."
              actionLabel="Reserve a slot"
              onAction={() => navigation.navigate('Reservation')}
            />
          </Card>
        )}
      </View>

      <View style={styles.block}>
        <SectionHeader title="Quick actions" />
        <View style={styles.quickActions}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => navigation.navigate(action.route as never)}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [
                styles.quickAction,
                {
                  backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name={action.icon} size={24} color={colors.tealDark} />
              <Text style={[typeToken('small', textScale), { color: colors.text }]} numberOfLines={1}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {recentReservations.length > 0 ? (
        <View style={styles.block}>
          <SectionHeader
            title="Recent bookings"
            action="See all"
            onAction={() => navigation.navigate('History')}
          />
          <Card style={styles.cardTight}>
            {recentReservations.map((reservation, index) => (
              <ListRow
                key={reservation.id}
                icon="receipt-outline"
                title={
                  slotInfo[reservation.slot_id]
                    ? `Slot ${slotInfo[reservation.slot_id].slot_code}`
                    : reservation.booking_code
                }
                subtitle={`${formatWindow(reservation.start_time, reservation.end_time)} · ${
                  reservation.booking_code
                }`}
                value={humanizeStatus(reservation.status)}
                onPress={() => navigation.navigate('History')}
                accessibilityLabel={`Booking ${reservation.booking_code}, ${humanizeStatus(
                  reservation.status
                )}, ${formatWindow(reservation.start_time, reservation.end_time)}`}
                style={index === recentReservations.length - 1 ? styles.lastRow : undefined}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionHeader
          title="My vehicles"
          action="Manage"
          onAction={() => navigation.navigate('MyVehicles')}
        />
        {vehicles.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="car-sport-outline"
              title="No vehicle yet"
              message="Add a vehicle so we can assign a bay to it."
              actionLabel="Add vehicle"
              onAction={() => navigation.navigate('MyVehicles')}
            />
          </Card>
        ) : (
          <Card style={styles.cardTight}>
            {vehicles.map((vehicle, index) => (
              <ListRow
                key={vehicle.id}
                icon="car-outline"
                title={vehicle.plate_number}
                subtitle={vehicle.vehicle_type}
                value={vehicle.is_default ? 'Default' : undefined}
                accessibilityLabel={`${vehicle.plate_number}, ${vehicle.vehicle_type}${
                  vehicle.is_default ? ', default vehicle' : ''
                }`}
                style={index === vehicles.length - 1 ? styles.lastRow : undefined}
              />
            ))}
          </Card>
        )}
      </View>

      <Text style={[typeToken('small', textScale), styles.footnote, { color: colors.textMuted }]}>
        Last updated {formatTime(new Date(tick).toISOString())}
      </Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flexText: {
    flex: 1,
  },
  block: {
    marginTop: spacing.lg,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  heroCard: {
    gap: spacing.xs,
    padding: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  countdown: {
    marginTop: spacing.xxs,
  },
  cameraCheck: {
    marginTop: spacing.sm,
    gap: spacing.xxs,
  },
  cameraCheckImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heroButton: {
    flex: 1,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    minHeight: TOUCH_TARGET + 28,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  cardTight: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  footnote: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
