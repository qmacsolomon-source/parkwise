import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  G,
  Image as SvgImage,
  Path,
  Polyline,
  Text as SvgText,
} from 'react-native-svg';
import { FloorPlanAvailabilityValue, FloorPlanLayout, FloorPlanSlot, pointAlongRoute } from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { ThemeColors, radius, spacing, type as typeToken } from '../theme/tokens';
import SegmentedControl from './SegmentedControl';
import {
  ENTRANCE,
  FLOOR_IMAGES,
  IMAGE_H,
  IMAGE_W,
  MapBox,
  boxForIndex,
  buildRouteToBox,
} from './floorMapArt';

/**
 * The mobile floor plan.
 *
 * The background is the real facility drawing (the same artwork and
 * hand-placed bay boxes the desktop console uses - see floorMapArt.ts), not a
 * drawn schematic: this is the actual layout, not an abstract stand-in for it.
 *
 * Selection: one press over the whole drawing snaps to the nearest bay, and
 * the snap radius is grown so that every bay offers at least a 44 dp target
 * (see MIN_HIT_DP). The "Floor plan | List" switch on the screens is the
 * exact, screen-reader friendly way to choose a particular bay.
 */

/** Minimum touch target per bay, in dp (WCAG 2.5.5 / iOS HIG). */
const MIN_HIT_DP = 44;
/** Movement in dp beyond which a touch is a drag/pan, not a tap. */
const DRAG_TOLERANCE_DP = 8;
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 1.6;
/**
 * Marker badge diameter, in canvas px. Main stalls are only ~63 px wide on
 * the 1920 px canvas (already tiny before zooming - see SlotList's own
 * comment on this), so the badge can't shrink too far without becoming
 * unreadable; this is a middle ground that stays legible while leaving a
 * visible margin of the artwork's own PWD wheelchair icon around it.
 */
const MARKER_SIZE = 42;

export const AVAILABILITY_META: {
  key: FloorPlanAvailabilityValue;
  label: string;
  meaning: string;
  glyph: string;
}[] = [
  { key: 'available', label: 'Available', meaning: 'Free for your chosen time', glyph: '✓' },
  { key: 'reserved', label: 'Reserved', meaning: 'Taken by another driver', glyph: '—' },
  { key: 'mine', label: 'Your booking', meaning: 'One of your reservations', glyph: '●' },
  { key: 'pwd_locked', label: 'PWD only', meaning: 'Needs a verified PWD permit', glyph: 'P' },
  { key: 'maintenance', label: 'Closed', meaning: 'Out of service', glyph: '✕' },
];

export function availabilityColor(key: FloorPlanAvailabilityValue, colors: ThemeColors): string {
  switch (key) {
    case 'reserved':
      return colors.slotReserved;
    case 'mine':
      return colors.slotMine;
    case 'pwd_locked':
      return colors.slotPwdLocked;
    case 'maintenance':
      return colors.slotMaintenance;
    case 'available':
    default:
      return colors.slotAvailable;
  }
}

export function availabilityLabel(key: FloorPlanAvailabilityValue): string {
  return AVAILABILITY_META.find((entry) => entry.key === key)?.label ?? 'Available';
}

export interface FloorPlanProps {
  slots: FloorPlanSlot[];
  layout: FloorPlanLayout;
  floor: number;
  onFloorChange?: (floor: number) => void;
  /** Highlighted bay (the one being considered / chosen). */
  selectedSlotId?: string | null;
  /** Bay to draw the driving route to. */
  routeSlotId?: string | null;
  onSelectSlot?: (slot: FloorPlanSlot) => void;
  showLegend?: boolean;
  /** Small print under the plan, e.g. where the layout came from. */
  footnote?: string | null;
  style?: ViewStyle;
}

interface PositionedSlot {
  slot: FloorPlanSlot;
  box: MapBox;
  zone: 'block_a' | 'side';
}

export default function FloorPlan({
  slots,
  floor,
  onFloorChange,
  selectedSlotId,
  routeSlotId,
  onSelectSlot,
  showLegend = true,
  footnote,
  style,
}: FloorPlanProps) {
  const { colors, textScale, reduceMotion } = useTheme();
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const canvasW = IMAGE_W;
  const canvasH = IMAGE_H;
  const aspect = canvasW / canvasH;

  // Matches a bay to its box exactly how the desktop console does: every bay
  // in a zone, sorted by column, indexed into that zone's fixed box list.
  const floorSlots: PositionedSlot[] = useMemo(() => {
    const onFloor = slots.filter((slot) => slot.floor === floor);
    const positioned: PositionedSlot[] = [];

    (['block_a', 'side'] as const).forEach((zone) => {
      onFloor
        .filter((slot) => slot.zone === zone)
        .sort((a, b) => a.zone_col - b.zone_col)
        .forEach((slot, index) => {
          const box = boxForIndex(zone, index);
          if (box) positioned.push({ slot, box, zone });
        });
    });

    return positioned;
  }, [slots, floor]);

  const selectedEntry = useMemo(
    () => floorSlots.find((entry) => entry.slot.slot_id === selectedSlotId) ?? null,
    [floorSlots, selectedSlotId]
  );

  const routeEntry = useMemo(
    () => floorSlots.find((entry) => entry.slot.slot_id === routeSlotId) ?? null,
    [floorSlots, routeSlotId]
  );

  const routePoints = useMemo(() => {
    if (!routeEntry) return null;
    return buildRouteToBox(routeEntry.box, routeEntry.zone);
  }, [routeEntry]);

  const floorImage = FLOOR_IMAGES[floor] ?? FLOOR_IMAGES[1];

  // --- zoom + pan ---------------------------------------------------------
  // The phone screen is far too small for 69 bays at once, so the drawing can
  // be pinched (or stepped with the zoom buttons, which is the accessible and
  // one-handed path) and dragged. The frame never scrolls sideways: the
  // transformed content is clipped by the frame.
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef({ w: 0, h: 0 });
  const zoomedRef = useRef(false);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const [zoomed, setZoomed] = useState(false);

  const applyTransform = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }) => {
      const clamped = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
      const { w, h } = frameRef.current;
      // Panning is bounded so the plan can never be dragged out of the frame.
      const limitX = w > 0 ? (w * (clamped - 1)) / 2 : 0;
      const limitY = h > 0 ? (h * (clamped - 1)) / 2 : 0;
      const offset =
        clamped <= MIN_SCALE + 0.001
          ? { x: 0, y: 0 }
          : {
              x: Math.min(Math.max(nextOffset.x, -limitX), limitX),
              y: Math.min(Math.max(nextOffset.y, -limitY), limitY),
            };

      scaleRef.current = clamped;
      offsetRef.current = offset;
      scale.setValue(clamped);
      translateX.setValue(offset.x);
      translateY.setValue(offset.y);

      const isZoomed = clamped > MIN_SCALE + 0.01;
      if (isZoomed !== zoomedRef.current) {
        zoomedRef.current = isZoomed;
        setZoomed(isZoomed);
      }
    },
    [scale, translateX, translateY]
  );

  const stepZoom = useCallback(
    (factor: number) => {
      applyTransform(scaleRef.current * factor, offsetRef.current);
    },
    [applyTransform]
  );

  const resetView = useCallback(() => {
    applyTransform(MIN_SCALE, { x: 0, y: 0 });
  }, [applyTransform]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Taps must reach the Pressable, so the parent never claims a touch
        // that has not moved; a drag or a second finger takes it over.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (event, gesture) =>
          event.nativeEvent.touches.length >= 2 ||
          Math.abs(gesture.dx) > DRAG_TOLERANCE_DP ||
          Math.abs(gesture.dy) > DRAG_TOLERANCE_DP,
        onMoveShouldSetPanResponderCapture: (event, gesture) =>
          event.nativeEvent.touches.length >= 2 ||
          Math.abs(gesture.dx) > DRAG_TOLERANCE_DP ||
          Math.abs(gesture.dy) > DRAG_TOLERANCE_DP,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            pinchRef.current = { distance: touchDistance(touches), scale: scaleRef.current };
            panRef.current = null;
          } else {
            panRef.current = { x: offsetRef.current.x, y: offsetRef.current.y };
            pinchRef.current = null;
          }
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            if (!pinchRef.current) {
              pinchRef.current = { distance: touchDistance(touches), scale: scaleRef.current };
            }
            const start = pinchRef.current;
            const ratio = touchDistance(touches) / (start.distance || 1);
            applyTransform(start.scale * ratio, offsetRef.current);
            return;
          }
          // Single finger: pan, but only when the plan is actually zoomed in.
          if (scaleRef.current <= MIN_SCALE + 0.001) return;
          const start = panRef.current ?? { x: offsetRef.current.x, y: offsetRef.current.y };
          applyTransform(scaleRef.current, { x: start.x + gesture.dx, y: start.y + gesture.dy });
        },
        onPanResponderRelease: () => {
          pinchRef.current = null;
          panRef.current = null;
        },
        onPanResponderTerminate: () => {
          pinchRef.current = null;
          panRef.current = null;
        },
      }),
    [applyTransform]
  );

  // --- tapping ------------------------------------------------------------
  const handleFrameLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    frameRef.current = { w: width, h: height };
    setFrame({ w: width, h: height });
  }, []);

  const handleTap = useCallback(
    (locationX: number, locationY: number) => {
      if (!onSelectSlot || frame.w <= 0 || floorSlots.length === 0) return;

      // Screen px -> canvas units, undoing the zoom/pan transform.
      const toCanvas = canvasW / frame.w;
      const canvasX = ((locationX - offsetRef.current.x) / scaleRef.current) * toCanvas;
      const canvasY = ((locationY - offsetRef.current.y) / scaleRef.current) * toCanvas;

      let best: PositionedSlot | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const entry of floorSlots) {
        const centreX = entry.box.x + entry.box.w / 2;
        const centreY = entry.box.y + entry.box.h / 2;
        const distance = Math.hypot(centreX - canvasX, centreY - canvasY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entry;
        }
      }

      if (!best) return;

      // Guarantee a >=44 dp target per bay: the tap is accepted if it lands
      // within half a 44 dp box, or anywhere inside the bay's own rectangle.
      const minRadius = (MIN_HIT_DP / 2) * toCanvas;
      const ownRadius = Math.hypot(best.box.w / 2, best.box.h / 2);
      if (bestDistance <= Math.max(minRadius, ownRadius)) onSelectSlot(best.slot);
    },
    [canvasW, floorSlots, frame.w, onSelectSlot]
  );

  const availableFloors = useMemo(() => {
    const floors = Array.from(new Set(slots.map((slot) => slot.floor))).sort((a, b) => a - b);
    return floors.length > 0 ? floors : [1, 2, 3];
  }, [slots]);

  const polyline = routePoints ? routePoints.map((p) => `${p.x},${p.y}`).join(' ') : null;
  const arrowHead = routePoints ? routePoints[routePoints.length - 1] : null;
  const arrowAngle = useMemo(() => {
    if (!routePoints || routePoints.length < 2) return 0;
    const last = routePoints[routePoints.length - 1];
    const prev = routePoints[routePoints.length - 2];
    return (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
  }, [routePoints]);

  const dimmed = !!routeEntry;

  const pctX = (value: number): `${number}%` => `${(value / canvasW) * 100}%`;
  const pctY = (value: number): `${number}%` => `${(value / canvasH) * 100}%`;

  return (
    <View style={style}>
      {onFloorChange && availableFloors.length > 1 ? (
        <SegmentedControl
          accessibilityLabel="Choose a floor"
          options={availableFloors.map((value) => ({ label: `Floor ${value}`, value: String(value) }))}
          value={String(floor)}
          onChange={(next) => onFloorChange(Number(next))}
          style={styles.floorSwitch}
        />
      ) : null}

      <View
        style={[
          styles.planFrame,
          { borderColor: colors.border, backgroundColor: colors.surfaceAlt, aspectRatio: aspect },
        ]}
        onLayout={handleFrameLayout}
        {...responder.panHandlers}
      >
        <Animated.View
          style={[
            styles.content,
            { transform: [{ translateX }, { translateY }, { scale }] },
          ]}
        >
          <Pressable
            onPress={(event) =>
              handleTap(event.nativeEvent.locationX, event.nativeEvent.locationY)
            }
            accessibilityRole="imagebutton"
            accessibilityLabel={
              selectedEntry
                ? `Floor ${floor} plan. Selected ${selectedEntry.slot.slot_code}, ${availabilityLabel(
                    selectedEntry.slot.availability
                  )}.`
                : `Floor ${floor} parking plan, ${floorSlots.length} bays. Use the List view for an exact bay.`
            }
            accessibilityHint="Tap near a bay to inspect it, or switch to the List view to choose an exact bay."
            style={styles.pressable}
          >
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${canvasW} ${canvasH}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* The real facility drawing - same artwork and boxes as the desktop console. */}
              <SvgImage
                href={floorImage}
                x={0}
                y={0}
                width={canvasW}
                height={canvasH}
                preserveAspectRatio="xMidYMid slice"
              />

              {floorSlots.map(({ slot, box }) => {
                const color = availabilityColor(slot.availability, colors);
                const isSelected = slot.slot_id === selectedSlotId;
                const isRoute = slot.slot_id === routeSlotId;
                const opacity = dimmed && !isRoute ? 0.35 : 1;
                const glyph = AVAILABILITY_META.find((m) => m.key === slot.availability)?.glyph;
                const cx = box.x + box.w / 2;
                const cy = box.y + box.h / 2;
                const r = MARKER_SIZE / 2;

                return (
                  <G key={slot.slot_id} opacity={opacity}>
                    {isSelected || isRoute ? (
                      <Circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={colors.navy} strokeWidth={5} />
                    ) : null}
                    <Circle cx={cx} cy={cy} r={r} fill={color} stroke={colors.surface} strokeWidth={3} />
                    <SvgText
                      x={cx}
                      y={cy + 6}
                      fontSize={18}
                      fontWeight="700"
                      fill={colors.surface}
                      textAnchor="middle"
                    >
                      {glyph}
                    </SvgText>
                  </G>
                );
              })}

              {/* Entrance / start of the route. */}
              <Circle
                cx={ENTRANCE.x}
                cy={ENTRANCE.y}
                r={34}
                fill={colors.navy}
                stroke={colors.surface}
                strokeWidth={8}
              />
              <SvgText
                x={ENTRANCE.x}
                y={ENTRANCE.y + 12}
                fontSize={32}
                fontWeight="700"
                fill={colors.textOnDark}
                textAnchor="middle"
              >
                IN
              </SvgText>

              {polyline ? (
                <>
                  <Polyline
                    points={polyline}
                    fill="none"
                    stroke={colors.surface}
                    strokeWidth={20}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                  />
                  <Polyline
                    points={polyline}
                    fill="none"
                    stroke={colors.teal}
                    strokeWidth={11}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="28 20"
                  />
                </>
              ) : null}

              {arrowHead ? (
                <G transform={`translate(${arrowHead.x}, ${arrowHead.y}) rotate(${arrowAngle})`}>
                  <Path
                    d="M -30 -20 L 10 0 L -30 20 Z"
                    fill={colors.teal}
                    stroke={colors.surface}
                    strokeWidth={6}
                  />
                </G>
              ) : null}
            </Svg>

            {/* Layer 2 of the route guidance: travelling dot + pulsing ring. */}
            {routePoints ? (
              <RouteMotion
                points={routePoints}
                canvasW={canvasW}
                canvasH={canvasH}
                reduceMotion={reduceMotion}
                colour={colors.teal}
              />
            ) : null}

            {routeEntry ? (
              <PulsingRing
                box={routeEntry.box}
                reduceMotion={reduceMotion}
                colour="#FF9500" // Bright orange for assigned slot
                pctX={pctX}
                pctY={pctY}
              />
            ) : null}

            {routePoints ? (
              <View
                style={[styles.youBadge, { left: pctX(ENTRANCE.x), top: pctY(ENTRANCE.y) }]}
                pointerEvents="none"
              >
                <Text style={[typeToken('small', textScale), { color: colors.textOnDark }]}>YOU</Text>
              </View>
            ) : null}

            {selectedEntry ? (
              <View style={[styles.callout, { borderColor: colors.border }]} pointerEvents="none">
                <View
                  style={[
                    styles.calloutDot,
                    { backgroundColor: availabilityColor(selectedEntry.slot.availability, colors) },
                  ]}
                />
                <Text
                  style={[typeToken('caption', textScale), { color: colors.text }]}
                  numberOfLines={1}
                >
                  {selectedEntry.slot.slot_code} · {availabilityLabel(selectedEntry.slot.availability)}
                  {selectedEntry.slot.is_pwd ? ' · PWD' : ''}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>

        {/* Zoom controls: the accessible alternative to pinching. */}
        <View style={styles.zoomBar} pointerEvents="box-none">
          <ZoomButton
            label="Zoom out"
            text="−"
            disabled={!zoomed}
            colours={colors}
            onPress={() => stepZoom(1 / SCALE_STEP)}
          />
          <ZoomButton
            label="Zoom in"
            text="+"
            colours={colors}
            onPress={() => stepZoom(SCALE_STEP)}
          />
          {zoomed ? (
            <ZoomButton label="Reset view" text="Reset" colours={colors} onPress={resetView} wide />
          ) : null}
        </View>

        {floorSlots.length === 0 ? (
          <Text style={[typeToken('caption', textScale), styles.emptyText, { color: colors.textMuted }]}>
            No bays with a position on floor {floor}.
          </Text>
        ) : null}
      </View>

      {showLegend ? <FloorPlanLegend textScale={textScale} /> : null}

      {footnote ? (
        <Text style={[typeToken('small', textScale), { color: colors.textMuted, marginTop: spacing.xs }]}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  if (touches.length < 2) return 0;
  const [a, b] = touches;
  return Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY);
}

/** One of the small zoom/reset buttons floating over the plan. */
function ZoomButton({
  label,
  text,
  onPress,
  disabled,
  wide,
  colours,
}: {
  label: string;
  text: string;
  onPress: () => void;
  disabled?: boolean;
  wide?: boolean;
  colours: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.zoomButton,
        wide && styles.zoomButtonWide,
        {
          backgroundColor: colours.surface,
          borderColor: colours.borderStrong,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[typeToken('caption'), { color: colours.text }]}>{text}</Text>
    </Pressable>
  );
}

/** Travelling marker that walks the route, unless motion is reduced. */
function RouteMotion({
  points,
  canvasW,
  canvasH,
  reduceMotion,
  colour,
}: {
  points: { x: number; y: number }[];
  canvasW: number;
  canvasH: number;
  reduceMotion: boolean;
  colour: string;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      setProgress(1);
      return;
    }
    const timer = setInterval(() => {
      setProgress((current) => (current >= 1 ? 0 : Math.min(current + 0.016, 1)));
    }, 60);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const point = pointAlongRoute(points, progress);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.motionDot,
        {
          backgroundColor: colour,
          left: `${(point.x / canvasW) * 100}%`,
          top: `${(point.y / canvasH) * 100}%`,
        },
      ]}
    />
  );
}

/** Expanding ring around the destination bay. */
function PulsingRing({
  box,
  reduceMotion,
  colour,
  pctX,
  pctY,
}: {
  box: MapBox;
  reduceMotion: boolean;
  colour: string;
  pctX: (value: number) => `${number}%`;
  pctY: (value: number) => `${number}%`;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800, // Slightly faster for "blinking" feel
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const style = reduceMotion
    ? { opacity: 0.9, transform: [{ scale: 1 }] }
    : {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
      };

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        {
          borderColor: colour,
          left: pctX(box.x),
          top: pctY(box.y),
          width: pctX(box.w),
          height: pctY(box.h),
        },
        style,
      ]}
    />
  );
}

/** Colour + wording + shape for every state; safe for colour-blind users. */
export function FloorPlanLegend({ textScale = 1 }: { textScale?: number }) {
  const { colors } = useTheme();

  return (
    <View style={styles.legend} accessibilityRole="list">
      {AVAILABILITY_META.map((entry) => (
        <View
          key={entry.key}
          style={styles.legendItem}
          accessibilityRole="text"
          accessibilityLabel={`${entry.label}: ${entry.meaning}`}
        >
          <View
            style={[
              styles.legendSwatch,
              { backgroundColor: availabilityColor(entry.key, colors), borderColor: colors.borderStrong },
            ]}
          >
            <Text style={styles.legendGlyph}>{entry.glyph}</Text>
          </View>
          <Text style={[typeToken('small', textScale), { color: colors.text }]}>{entry.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  floorSwitch: {
    marginBottom: spacing.sm,
  },
  planFrame: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pressable: {
    flex: 1,
  },
  zoomBar: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  zoomButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  zoomButtonWide: {
    minWidth: 64,
  },
  emptyText: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.sm,
    textAlign: 'center',
  },
  motionDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    marginTop: -7,
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 3,
    borderRadius: radius.sm,
  },
  youBadge: {
    position: 'absolute',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(15, 42, 74, 0.85)',
    marginLeft: -18,
    marginTop: -46,
  },
  callout: {
    position: 'absolute',
    left: spacing.xs,
    bottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  calloutDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  legendSwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendGlyph: {
    fontSize: 10,
    lineHeight: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
