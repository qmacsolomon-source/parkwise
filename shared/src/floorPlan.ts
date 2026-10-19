// Floor plan geometry + route text.
//
// Pure functions, no React, no platform code: the desktop build (tsc -> dist)
// and the phone (Metro reads this .ts directly) both use this file.
//
// Coordinates are on the SAME canvas as the reference drawings the desktop
// console draws on: desktop/src/assets/floor-maps/floor-{n}.png, 1920x1080
// (see desktop/src/components/ParkingFloorMap.tsx). The phone therefore
// renders the desktop's floor plan, not a re-drawing of it.

export type SlotFacing = 'left' | 'right' | 'up' | 'down';

/** What the caller may do with a slot in the requested time window. */
export type FloorPlanAvailabilityValue =
  | 'available'
  | 'reserved'
  | 'mine'
  | 'maintenance'
  | 'pwd_locked';

/** One row of the `facility_layout` table. */
export interface FloorPlanLayout {
  canvas_width: number;
  canvas_height: number;
  entrance_x: number;
  entrance_y: number;
  aisle: FloorPlanAisle | null;
}

export interface FloorPlanAisle {
  entrance?: Point;
  trunk?: { x: number; y0: number; y1: number };
  crossLane?: { y: number; x0: number; x1: number };
}

/** One row of `get_floor_plan(start, end)`. */
export interface FloorPlanSlot {
  slot_id: string;
  slot_code: string;
  is_pwd: boolean;
  floor: number;
  zone: string;
  zone_row: string | null;
  zone_col: number;
  floor_x: number | null;
  floor_y: number | null;
  floor_w: number | null;
  floor_h: number | null;
  facing: SlotFacing | null;
  entry_rank: number | null;
  availability: FloorPlanAvailabilityValue;
}

export interface Point {
  x: number;
  y: number;
}

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
  '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th'];

export function ordinal(n: number): string {
  if (n >= 1 && n < ORDINALS.length) return ORDINALS[n];
  const mod100 = n % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix}`;
}

/** True when the slot carries usable geometry from the database. */
export function hasGeometry(slot: FloorPlanSlot): boolean {
  return (
    typeof slot.floor_x === 'number' &&
    typeof slot.floor_y === 'number' &&
    typeof slot.floor_w === 'number' &&
    typeof slot.floor_h === 'number'
  );
}

/**
 * The middle of the edge a slot opens onto the aisle -- where the car actually
 * drives in. `facing` is the side that opens onto the lane.
 */
export function getAccessPoint(slot: FloorPlanSlot): Point {
  const x = slot.floor_x ?? 0;
  const y = slot.floor_y ?? 0;
  const w = slot.floor_w ?? 0;
  const h = slot.floor_h ?? 0;

  switch (slot.facing) {
    case 'up':
      return { x: x + w / 2, y };
    case 'left':
      return { x, y: y + h / 2 };
    case 'right':
      return { x: x + w, y: y + h / 2 };
    case 'down':
    default:
      return { x: x + w / 2, y: y + h };
  }
}

function entranceOf(layout: FloorPlanLayout): Point {
  return layout.aisle?.entrance ?? { x: layout.entrance_x, y: layout.entrance_y };
}

/**
 * Polyline the driver walks/drives from the entrance to the slot's access
 * point, following the facility aisle: up the trunk lane, then along the
 * cross lane for the block-A bays (or straight to the far wall for the side
 * column). Returns [entrance, ...waypoints, accessPoint].
 */
export function computeRoute(layout: FloorPlanLayout, slot: FloorPlanSlot): Point[] {
  const entrance = entranceOf(layout);
  const access = getAccessPoint(slot);
  const trunk = layout.aisle?.trunk;
  const cross = layout.aisle?.crossLane;

  const points: Point[] = [entrance];

  if (trunk && slot.zone === 'block_a' && cross) {
    // Up the trunk lane to the cross lane, across it, then into the bay.
    points.push({ x: trunk.x, y: cross.y });
    points.push({ x: access.x, y: cross.y });
  } else if (trunk && slot.zone === 'side') {
    // Up the trunk lane to the bay's own height, then across to the far wall.
    points.push({ x: trunk.x, y: access.y });
  }

  points.push(access);

  // Drop consecutive duplicates so the drawn line has no zero-length legs.
  return points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y
  );
}

/** Which way the driver turns first: used for the single big arrow summary. */
export function primaryDirection(
  layout: FloorPlanLayout,
  slot: FloorPlanSlot
): 'straight' | 'left' | 'right' {
  const trunk = layout.aisle?.trunk;
  if (!trunk || slot.zone !== 'block_a') return 'straight';
  const access = getAccessPoint(slot);
  if (Math.abs(access.x - trunk.x) < 1) return 'straight';
  return access.x < trunk.x ? 'left' : 'right';
}

/**
 * Human-readable steps from describeDirections(). Plain sentences, safe to
 * show one per line and to read out with a screen reader.
 */
export function describeDirections(layout: FloorPlanLayout, slot: FloorPlanSlot): string[] {
  const steps: string[] = [];
  const trunk = layout.aisle?.trunk;
  const access = getAccessPoint(slot);

  steps.push('Enter the parking area from the entrance.');

  if (trunk && slot.zone === 'block_a') {
    const turn = primaryDirection(layout, slot);
    if (turn === 'straight') {
      steps.push('Keep going straight along the main drive aisle.');
    } else {
      steps.push(`Follow the main drive aisle and turn ${turn} at the Block A crossing.`);
    }
    // The row can hold any number of bays (60 in the live layout), so the step
    // says which side to look on rather than "the Nth bay" -- the exact bay is
    // named by its slot code, and entry_rank below says how close it is.
    const side = slot.zone_row === 'top' ? 'right' : 'left';
    steps.push(`Slot ${slot.slot_code} is on your ${side}, along the row ahead.`);
  } else if (trunk && slot.zone === 'side') {
    steps.push('Follow the main drive aisle up to the far wall.');
    steps.push(`Slot ${slot.slot_code} is on your right, along the wall.`);
  } else {
    steps.push(`Head to slot ${slot.slot_code}.`);
  }

  if (typeof slot.entry_rank === 'number') {
    steps.push(`This bay is the ${ordinal(slot.entry_rank)} closest to the entrance.`);
  }

  return steps;
}

/** One-line summary of describeDirections(), for the collapsed card. */
export function describeRouteShort(layout: FloorPlanLayout, slot: FloorPlanSlot): string {
  const turn = primaryDirection(layout, slot);
  if (slot.zone === 'block_a' && turn !== 'straight') {
    return `Turn ${turn} at Block A, then ${slot.slot_code} on your ${
      slot.zone_row === 'top' ? 'right' : 'left'
    }`;
  }
  if (slot.zone === 'side') {
    return `Straight to the far wall, then ${slot.slot_code} on your right`;
  }
  return `Straight ahead to slot ${slot.slot_code}`;
}

/** Length of the route polyline in canvas units (1920x1080 space). */
export function routeLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Point at fraction `t` (0 = entrance, 1 = the bay) along the route polyline.
 * Used for the travelling marker; the mobile side steps `t` on a timer so it
 * works with plain RN Animated and respects the reduce-motion setting.
 */
export function pointAlongRoute(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const clamped = Math.min(Math.max(t, 0), 1);
  const total = routeLength(points);
  if (total === 0) return points[0];

  let travelled = clamped * total;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const leg = Math.hypot(to.x - from.x, to.y - from.y);
    if (travelled <= leg || i === points.length - 1) {
      const ratio = leg === 0 ? 0 : Math.min(travelled / leg, 1);
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      };
    }
    travelled -= leg;
  }

  return points[points.length - 1];
}
