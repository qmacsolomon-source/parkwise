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
  Line,
  Path,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import {
  BLOCK_A_RECT,
  FloorPlanAvailabilityValue,
  FloorPlanLayout,
  FloorPlanSlot,
  IMAGE_H,
  IMAGE_W,
  SIDE_RECT,
  computeRoute,
  hasGeometry,
  pointAlongRoute,
} from '@parkwise/shared';
import { useTheme } from '../contexts/AccessibilityContext';
import { ThemeColors, radius, spacing, type as typeToken } from '../theme/tokens';
import SegmentedControl from './SegmentedControl';

/**
 * The mobile floor plan.
 *
 * The drawing is SCHEMATIC: every bay is a vector rectangle placed on the
 * 1920x1080 canvas by the layout data itself (the same rectangles
 * database/live_upgrade/03_floor_plan_207.sql writes into slots.floor_x etc.,
 * mirrored by shared/src/floorLayout.ts). There is no background image -- the
 * repo only has the OLD 34-bay reference drawings, which do not describe this
 * 207-bay facility, so drawing from the data is the only honest option.
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

export default function FloorPlan({
  slots,
  layout,
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

  const canvasW = layout.canvas_width || IMAGE_W;
  const canvasH = layout.canvas_height || IMAGE_H;
  const aspect = canvasW / canvasH;

  const floorSlots = useMemo(
    () => slots.filter((slot) => slot.floor === floor && hasGeometry(slot)),
    [slots, floor]
  );

  const selectedSlot = useMemo(
    () => floorSlots.find((slot) => slot.slot_id === selectedSlotId) ?? null,
    [floorSlots, selectedSlotId]
  );

  const routeSlot = useMemo(
    () => floorSlots.find((slot) => slot.slot_id === routeSlotId) ?? null,
    [floorSlots, routeSlotId]
  );

  const routePoints = useMemo(() => {
    if (!routeSlot) return null;
    const points = computeRoute(layout, routeSlot);
    return points.length >= 2 ? points : null;
  }, [layout, routeSlot]);

  const availableFloors = useMemo(() => {
    const floors = Array.from(new Set(slots.map((slot) => slot.floor))).sort((a, b) => a - b);
    return floors.length > 0 ? floors : [1, 2, 3];
  }, [slots]);

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

      let best: FloorPlanSlot | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const slot of floorSlots) {
        const centreX = (slot.floor_x ?? 0) + (slot.floor_w ?? 0) / 2;
        const centreY = (slot.floor_y ?? 0) + (slot.floor_h ?? 0) / 2;
        const distance = Math.hypot(centreX - canvasX, centreY - canvasY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = slot;
        }
      }

      if (!best) return;

      // Guarantee a >=44 dp target per bay: the tap is accepted if it lands
      // within half a 44 dp box, or anywhere inside the bay's own rectangle.
      const minRadius = (MIN_HIT_DP / 2) * toCanvas;
      const ownRadius = Math.hypot((best.floor_w ?? 0) / 2, (best.floor_h ?? 0) / 2);
      if (bestDistance <= Math.max(minRadius, ownRadius)) onSelectSlot(best);
    },
    [canvasW, floorSlots, frame.w, onSelectSlot]
  );

  const pctX = (value: number): `${number}%` => `${(value / canvasW) * 100}%`;
  const pctY = (value: number): `${number}%` => `${(value / canvasH) * 100}%`;

  const entrance = layout.aisle?.entrance ?? { x: layout.entrance_x, y: layout.entrance_y };
  const trunk = layout.aisle?.trunk ?? null;
  const cross = layout.aisle?.crossLane ?? null;
  const polyline = routePoints ? routePoints.map((p) => `${p.x},${p.y}`).join(' ') : null;
  const arrowHead = routePoints ? routePoints[routePoints.length - 1] : null;

  const dimmed = !!routeSlot;

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
              selectedSlot
                ? `Floor ${floor} plan. Selected ${selectedSlot.slot_code}, ${availabilityLabel(
                    selectedSlot.availability
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
              {/* The driving lanes, drawn from facility_layout.aisle. */}
              <Rect x={0} y={0} width={canvasW} height={canvasH} fill={colors.surfaceAlt} />
              <G opacity={0.75}>
                <Rect
                  x={BLOCK_A_RECT.x0}
                  y={BLOCK_A_RECT.y0}
                  width={BLOCK_A_RECT.x1 - BLOCK_A_RECT.x0}
                  height={BLOCK_A_RECT.y1 - BLOCK_A_RECT.y0}
                  fill="none"
                  stroke={colors.borderStrong}
                  strokeWidth={4}
                  strokeDasharray="18 14"
                />
                <Rect
                  x={SIDE_RECT.x0}
                  y={SIDE_RECT.y0}
                  width={SIDE_RECT.x1 - SIDE_RECT.x0}
                  height={SIDE_RECT.y1 - SIDE_RECT.y0}
                  fill="none"
                  stroke={colors.borderStrong}
                  strokeWidth={4}
                  strokeDasharray="18 14"
                />
              </G>
              {trunk ? (
                <Rect
                  x={trunk.x - 45}
                  y={trunk.y0}
                  width={90}
                  height={trunk.y1 - trunk.y0}
                  fill={colors.border}
                  opacity={0.7}
                />
              ) : null}
              {cross ? (
                <Rect
                  x={cross.x0}
                  y={cross.y - 45}
                  width={cross.x1 - cross.x0}
                  height={90}
                  fill={colors.border}
                  opacity={0.7}
                />
              ) : null}

              {floorSlots.map((slot) => {
                const x = slot.floor_x ?? 0;
                const y = slot.floor_y ?? 0;
                const w = slot.floor_w ?? 0;
                const h = slot.floor_h ?? 0;
                const color = availabilityColor(slot.availability, colors);
                const isSelected = slot.slot_id === selectedSlotId;
                const isRoute = slot.slot_id === routeSlotId;
                const opacity = dimmed && !isRoute ? 0.28 : 0.9;
                const glyph = AVAILABILITY_META.find((m) => m.key === slot.availability)?.glyph;

                return (
                  <React.Fragment key={slot.slot_id}>
                    <Rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={5}
                      fill={color}
                      opacity={opacity}
                      stroke={isSelected || isRoute ? colors.navy : colors.surface}
                      strokeWidth={isSelected || isRoute ? 9 : 3}
                    />
                    {/* Shape + letter, so state is never carried by colour alone. */}
                    {slot.availability === 'reserved' ? (
                      <Line
                        x1={x + w * 0.22}
                        y1={y + h / 2}
                        x2={x + w * 0.78}
                        y2={y + h / 2}
                        stroke={colors.surface}
                        strokeWidth={10}
                        opacity={opacity}
                      />
                    ) : null}
                    {slot.availability === 'mine' ? (
                      <Circle
                        cx={x + w / 2}
                        cy={y + h / 2}
                        r={Math.min(w, h) * 0.22}
                        fill={colors.surface}
                        opacity={opacity}
                      />
                    ) : null}
                    {slot.availability === 'maintenance' ? (
                      <Path
                        d={`M ${x + w * 0.24} ${y + h * 0.3} L ${x + w * 0.76} ${y + h * 0.7}`}
                        stroke={colors.surface}
                        strokeWidth={10}
                        strokeLinecap="round"
                        opacity={opacity}
                      />
                    ) : null}
                    {slot.availability === 'pwd_locked' ? (
                      <Circle
                        cx={x + w / 2}
                        cy={y + h / 2}
                        r={Math.min(w, h) * 0.3}
                        fill="none"
                        stroke={colors.surface}
                        strokeWidth={8}
                        strokeDasharray="12 9"
                        opacity={opacity}
                      />
                    ) : null}
                    {slot.is_pwd ? (
                      <Rect
                        x={x + 3}
                        y={y + 3}
                        width={Math.max(w - 6, 4)}
                        height={Math.max(h - 6, 4)}
                        rx={3}
                        fill="none"
                        stroke={colors.surface}
                        strokeWidth={5}
                        opacity={opacity}
                      />
                    ) : null}
                    {glyph && w >= 34 && h >= 34 ? (
                      <SvgText
                        x={x + w / 2}
                        y={y + h / 2 + 12}
                        fontSize={30}
                        fontWeight="700"
                        fill={colors.surface}
                        textAnchor="middle"
                        opacity={opacity}
                      >
                        {glyph}
                      </SvgText>
                    ) : null}
                  </React.Fragment>
                );
              })}

              {/* Entrance / start of the route. */}
              <Circle
                cx={entrance.x}
                cy={entrance.y}
                r={34}
                fill={colors.navy}
                stroke={colors.surface}
                strokeWidth={8}
              />
              <SvgText
                x={entrance.x}
                y={entrance.y + 12}
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
                <Circle
                  cx={arrowHead.x}
                  cy={arrowHead.y}
                  r={24}
                  fill={colors.teal}
                  stroke={colors.surface}
                  strokeWidth={8}
                />
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

            {routeSlot ? (
              <PulsingRing
                slot={routeSlot}
                canvasW={canvasW}
                canvasH={canvasH}
                reduceMotion={reduceMotion}
                colour={colors.teal}
                pctX={pctX}
                pctY={pctY}
              />
            ) : null}

            {routePoints ? (
              <View
                style={[styles.youBadge, { left: pctX(entrance.x), top: pctY(entrance.y) }]}
                pointerEvents="none"
              >
                <Text style={[typeToken('small', textScale), { color: colors.textOnDark }]}>YOU</Text>
              </View>
            ) : null}

            {selectedSlot ? (
              <View style={[styles.callout, { borderColor: colors.border }]} pointerEvents="none">
                <View
                  style={[
                    styles.calloutDot,
                    { backgroundColor: availabilityColor(selectedSlot.availability, colors) },
                  ]}
                />
                <Text
                  style={[typeToken('caption', textScale), { color: colors.text }]}
                  numberOfLines={1}
                >
                  {selectedSlot.slot_code} · {availabilityLabel(selectedSlot.availability)}
                  {selectedSlot.is_pwd ? ' · PWD' : ''}
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
  slot,
  canvasW,
  canvasH,
  reduceMotion,
  colour,
  pctX,
  pctY,
}: {
  slot: FloorPlanSlot;
  canvasW: number;
  canvasH: number;
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
          duration: 1100,
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
          left: pctX(slot.floor_x ?? 0),
          top: pctY(slot.floor_y ?? 0),
          width: pctX(slot.floor_w ?? 0),
          height: pctY(slot.floor_h ?? 0),
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
