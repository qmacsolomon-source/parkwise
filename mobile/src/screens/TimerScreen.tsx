import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Reservation } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { spacing, TOUCH_TARGET, type as typeToken } from '../theme/tokens';
import {
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  StatusChip,
} from '../components/ui';
import type { ChipTone } from '../components/ui';
import AppScreen from '../components/AppScreen';

type RootStackParamList = {
  Timer: undefined;
  Reservation: undefined;
  Wayfinding: {
    reservationId?: string;
    slotId?: string;
    slotCode?: string;
    start?: string;
    end?: string;
  };
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_SIZE = 236;
const RING_STROKE = 16;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: string): ChipTone {
  switch (status) {
    case 'active':
      return 'warning';
    case 'verified':
      return 'success';
    case 'pending':
      return 'info';
    default:
      return 'neutral';
  }
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

interface DetailRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  last?: boolean;
}

function DetailRow({ icon, label, value, last = false }: DetailRowProps) {
  const { colors, textScale } = useTheme();

  return (
    <View
      style={[
        styles.detailRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[typeToken('body', textScale), styles.detailLabel, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[typeToken('bodyStrong', textScale), styles.detailValue, { color: colors.text }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
}

export default function TimerScreen() {
  const { profile } = useAuth();
  const { colors, textScale, reduceMotion } = useTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);
  /** reservations only store slot_id, so the readable code is looked up once. */
  const [slotCode, setSlotCode] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    loadActiveReservation();

    // Subscribe to reservation changes via Realtime
    const subscription = supabase
      .channel('active-reservation')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `customer_id=eq.${profile?.id}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const updated = payload.new as Reservation;
            if (updated.status === 'active' || updated.status === 'verified') {
              setActiveReservation(updated);
              void loadSlotCode(updated.slot_id);
            } else {
              setActiveReservation(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!activeReservation) return;

    const remainingNow = () =>
      Math.max(0, new Date(activeReservation.end_time).getTime() - Date.now());

    setTimeRemaining(remainingNow());

    const interval = setInterval(() => {
      const remaining = remainingNow();
      setTimeRemaining(remaining);

      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeReservation]);

  const loadActiveReservation = async () => {
    if (!supabase || !profile?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .eq('customer_id', profile.id)
        .in('status', ['active', 'verified'])
        .order('start_time', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          setActiveReservation(null);
        } else {
          console.error('Error loading reservation:', error);
        }
      } else if (data) {
        setActiveReservation(data);
        void loadSlotCode(data.slot_id);
      }
    } catch (error) {
      console.error('Error loading reservation:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadSlotCode = async (slotId: string) => {
    if (!supabase) return;

    const { data } = await supabase.from('slots').select('slot_code').eq('id', slotId).maybeSingle();
    if (data) setSlotCode((data as { slot_code: string }).slot_code);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadActiveReservation();
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const totalMs = activeReservation
    ? Math.max(
        1,
        new Date(activeReservation.end_time).getTime() -
          new Date(activeReservation.start_time).getTime()
      )
    : 1;
  const progress = activeReservation
    ? Math.min(1, Math.max(0, timeRemaining / totalMs))
    : 0;

  useEffect(() => {
    if (reduceMotion) {
      ring.setValue(progress);
      return;
    }

    const animation = Animated.timing(ring, {
      toValue: progress,
      duration: 600,
      useNativeDriver: false,
    });
    animation.start();

    return () => animation.stop();
  }, [progress, reduceMotion, ring]);

  const dashOffset = ring.interpolate({
    inputRange: [0, 1],
    outputRange: [RING_CIRCUMFERENCE, 0],
  });

  const scale = Math.min(textScale, 1.35);
  const readoutStyle = {
    fontSize: Math.round(38 * scale),
    lineHeight: Math.round(46 * scale),
  };

  return (
    <AppScreen
      header={<ScreenHeader title="Timer" subtitle="Your active parking session" />}
      tab="Timer"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={styles.loadingWrap}>
          <Skeleton width={RING_SIZE} height={RING_SIZE} radiusToken="pill" />
          <Skeleton width="55%" height={20} />
          <Skeleton width="35%" height={16} />
        </View>
      ) : !activeReservation ? (
        <EmptyState
          icon="timer-outline"
          title="No active session"
          message="You don't have an active parking session. Make a reservation to start the timer."
          actionLabel="Make a reservation"
          onAction={() => navigation.navigate('Reservation')}
        />
      ) : (
        <>
          <Card style={styles.ringCard}>
            <View style={styles.ringWrap}>
              <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke={colors.surfaceAlt}
                  strokeWidth={RING_STROKE}
                  fill="none"
                  rotation={-90}
                  originX={RING_SIZE / 2}
                  originY={RING_SIZE / 2}
                />
                <AnimatedCircle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke={colors.teal}
                  strokeWidth={RING_STROKE}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                  strokeDashoffset={dashOffset}
                  rotation={-90}
                  originX={RING_SIZE / 2}
                  originY={RING_SIZE / 2}
                />
              </Svg>

              <View
                style={styles.ringCenter}
                accessible
                accessibilityRole="timer"
                accessibilityLabel={`Time remaining ${formatTime(timeRemaining)} of ${formatTime(
                  totalMs
                )}`}
              >
                <Text style={[typeToken('caption', textScale), { color: colors.textMuted }]}>
                  Time remaining
                </Text>
                <Text style={[typeToken('display', textScale), readoutStyle, { color: colors.navy }]}>
                  {formatTime(timeRemaining)}
                </Text>
                <Text style={[typeToken('small', textScale), { color: colors.textMuted }]}>
                  of {formatTime(totalMs)}
                </Text>
              </View>
            </View>

            <View style={styles.ringFooter}>
              <StatusChip
                label={humanizeStatus(activeReservation.status)}
                tone={statusTone(activeReservation.status)}
              />
              <Text
                style={[typeToken('small', textScale), styles.ringBooking, { color: colors.textMuted }]}
                numberOfLines={1}
              >
                Slot {slotCode ?? '—'} · Booking {activeReservation.booking_code}
              </Text>
            </View>

            <Button
              label="Show me the way"
              icon="navigate"
              onPress={() =>
                navigation.navigate('Wayfinding', {
                  reservationId: activeReservation.id,
                  slotId: activeReservation.slot_id,
                  slotCode: slotCode ?? undefined,
                  start: activeReservation.start_time,
                  end: activeReservation.end_time,
                })
              }
              accessibilityHint="Opens the floor plan with the route to your bay"
              style={styles.wayButton}
            />
          </Card>

          <SectionHeader title="Session details" style={styles.section} />
          <Card style={styles.detailsCard}>
            <DetailRow
              icon="ticket-outline"
              label="Booking code"
              value={activeReservation.booking_code}
            />
            <DetailRow icon="car-outline" label="Slot" value={slotCode ?? activeReservation.slot_id} />
            <DetailRow
              icon="play-circle-outline"
              label="Start"
              value={formatClock(activeReservation.start_time)}
            />
            <DetailRow
              icon="stop-circle-outline"
              label="End"
              value={formatClock(activeReservation.end_time)}
              last
            />
          </Card>
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  ringCard: {
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  ringFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    width: '100%',
  },
  ringBooking: {
    flexShrink: 1,
  },
  wayButton: {
    width: '100%',
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  detailsCard: {
    paddingVertical: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    flex: 1,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
