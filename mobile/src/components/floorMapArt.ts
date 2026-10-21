// The real facility artwork, shared with the desktop console's
// ParkingFloorMap.tsx -- same images, same hand-placed box coordinates (the
// desktop boxes were marked directly over the real floor-1 drawing with a
// coordinate-picker tool; floors 2 and 3 reuse the exact same layout on top
// of their own images, since all three floors are the same physical plan).
// Kept as a plain copy rather than a shared module: desktop reads these as
// Vite asset imports and mobile reads them as Metro/Expo asset imports --
// two different bundlers, two different import mechanics, same values.
import floor1Image from '../../assets/floor-maps/floor-1.png';
import floor2Image from '../../assets/floor-maps/floor-2.png';
import floor3Image from '../../assets/floor-maps/floor-3.png';

export const IMAGE_W = 1920;
export const IMAGE_H = 1080;

export const FLOOR_IMAGES: Record<number, number> = {
  1: floor1Image,
  2: floor2Image,
  3: floor3Image,
};

export interface MapBox {
  x: number;
  y: number;
  w: number;
  h: number;
  pwd: boolean;
}

/** 60 stalls, 5 rows of 12. Reading order matches zone_col 1-60 on 'block_a'. */
export const MAIN_BOXES: MapBox[] = [
  { x: 440, y: 91, w: 63, h: 134, pwd: false },
  { x: 518, y: 92, w: 63, h: 134, pwd: false },
  { x: 591, y: 90, w: 63, h: 134, pwd: false },
  { x: 668, y: 91, w: 63, h: 134, pwd: false },
  { x: 744, y: 91, w: 63, h: 134, pwd: false },
  { x: 819, y: 92, w: 63, h: 134, pwd: false },
  { x: 892, y: 92, w: 63, h: 134, pwd: false },
  { x: 970, y: 92, w: 63, h: 134, pwd: true },
  { x: 1044, y: 90, w: 63, h: 134, pwd: true },
  { x: 1121, y: 91, w: 63, h: 134, pwd: true },
  { x: 1196, y: 91, w: 63, h: 134, pwd: true },
  { x: 1272, y: 92, w: 63, h: 134, pwd: true },
  { x: 439, y: 331, w: 63, h: 134, pwd: false },
  { x: 517, y: 332, w: 63, h: 134, pwd: false },
  { x: 590, y: 329, w: 63, h: 134, pwd: false },
  { x: 668, y: 330, w: 63, h: 134, pwd: false },
  { x: 743, y: 330, w: 63, h: 134, pwd: false },
  { x: 819, y: 331, w: 63, h: 134, pwd: false },
  { x: 892, y: 331, w: 63, h: 134, pwd: false },
  { x: 970, y: 332, w: 63, h: 134, pwd: false },
  { x: 1043, y: 329, w: 63, h: 134, pwd: false },
  { x: 1120, y: 331, w: 63, h: 134, pwd: false },
  { x: 1196, y: 331, w: 63, h: 134, pwd: false },
  { x: 1271, y: 331, w: 63, h: 134, pwd: false },
  { x: 441, y: 477, w: 63, h: 134, pwd: false },
  { x: 519, y: 478, w: 63, h: 134, pwd: false },
  { x: 592, y: 475, w: 63, h: 134, pwd: false },
  { x: 669, y: 476, w: 63, h: 134, pwd: false },
  { x: 745, y: 476, w: 63, h: 134, pwd: false },
  { x: 820, y: 477, w: 63, h: 134, pwd: false },
  { x: 893, y: 477, w: 63, h: 134, pwd: false },
  { x: 971, y: 478, w: 63, h: 134, pwd: false },
  { x: 1045, y: 476, w: 63, h: 134, pwd: false },
  { x: 1122, y: 477, w: 63, h: 134, pwd: false },
  { x: 1197, y: 477, w: 63, h: 134, pwd: false },
  { x: 1273, y: 477, w: 63, h: 134, pwd: false },
  { x: 442, y: 648, w: 63, h: 134, pwd: false },
  { x: 517, y: 648, w: 63, h: 134, pwd: false },
  { x: 590, y: 646, w: 63, h: 134, pwd: false },
  { x: 668, y: 647, w: 63, h: 134, pwd: false },
  { x: 743, y: 647, w: 63, h: 134, pwd: false },
  { x: 819, y: 648, w: 63, h: 134, pwd: false },
  { x: 892, y: 648, w: 63, h: 134, pwd: false },
  { x: 970, y: 649, w: 63, h: 134, pwd: false },
  { x: 1043, y: 646, w: 63, h: 134, pwd: false },
  { x: 1120, y: 647, w: 63, h: 134, pwd: false },
  { x: 1196, y: 647, w: 63, h: 134, pwd: false },
  { x: 1271, y: 648, w: 63, h: 134, pwd: false },
  { x: 444, y: 794, w: 63, h: 134, pwd: false },
  { x: 519, y: 795, w: 63, h: 134, pwd: false },
  { x: 592, y: 792, w: 63, h: 134, pwd: false },
  { x: 669, y: 793, w: 63, h: 134, pwd: false },
  { x: 745, y: 793, w: 63, h: 134, pwd: false },
  { x: 820, y: 794, w: 63, h: 134, pwd: false },
  { x: 893, y: 794, w: 63, h: 134, pwd: false },
  { x: 971, y: 795, w: 63, h: 134, pwd: false },
  { x: 1045, y: 793, w: 63, h: 134, pwd: false },
  { x: 1122, y: 794, w: 63, h: 134, pwd: false },
  { x: 1197, y: 794, w: 63, h: 134, pwd: false },
  { x: 1273, y: 794, w: 63, h: 134, pwd: false },
];

/** 9 stalls along the far wall. Reading order matches zone_col 1-9 on 'side'. */
export const SIDE_BOXES: MapBox[] = [
  { x: 1506, y: 275, w: 192, h: 72, pwd: true },
  { x: 1507, y: 351, w: 192, h: 72, pwd: true },
  { x: 1507, y: 428, w: 192, h: 72, pwd: true },
  { x: 1505, y: 503, w: 192, h: 72, pwd: true },
  { x: 1506, y: 579, w: 192, h: 72, pwd: true },
  { x: 1506, y: 652, w: 192, h: 72, pwd: false },
  { x: 1507, y: 729, w: 192, h: 72, pwd: false },
  { x: 1506, y: 806, w: 192, h: 72, pwd: false },
  { x: 1505, y: 881, w: 192, h: 72, pwd: false },
];

/**
 * Driving-lane geometry for THIS artwork specifically (not the abstract
 * schematic in shared/src/floorLayout.ts, which was built for a blank
 * synthetic canvas, not this drawing). Read directly off the real image: a
 * one-way loop entered top-left, with a horizontal drive aisle between each
 * back-to-back pair of stall rows. The three floors share one drawing, so
 * one set of lane positions covers all of them.
 */
export const ENTRANCE = { x: 320, y: 90 };
/** The vertical lane just left of the first stall column (x≈440). */
export const LEFT_LANE_X = 415;
/** The vertical lane between the main block (ends ≈1335) and the side column (starts ≈1505). */
export const RIGHT_LANE_X = 1420;
/**
 * Horizontal aisle bands, as the midpoint of the gap between each pair of
 * rows: rows 1/2 (y 224-329), rows 3/4 (y 609-646), and after row 5 toward
 * the bottom exit (y 926-990).
 */
export const AISLE_Y_BANDS = [276, 627, 958];

function nearestAisleY(targetY: number): number {
  return AISLE_Y_BANDS.reduce((closest, y) =>
    Math.abs(y - targetY) < Math.abs(closest - targetY) ? y : closest
  );
}

export interface RoutePoint {
  x: number;
  y: number;
}

/**
 * A simple, always-on-asphalt path from the entrance to a bay's centre:
 * down the left lane to the aisle nearest the target row, across to the
 * target's column, then (for the side column only) up the right lane to the
 * target's own height before the final approach. Not a simulation of the
 * facility's full one-way loop - just a path that never visually crosses a
 * row of stalls or a wall.
 */
export function buildRouteToBox(box: MapBox, zone: 'block_a' | 'side'): RoutePoint[] {
  const targetX = box.x + box.w / 2;
  const targetY = box.y + box.h / 2;
  const aisleY = nearestAisleY(targetY);

  if (zone === 'side') {
    return [
      ENTRANCE,
      { x: LEFT_LANE_X, y: ENTRANCE.y },
      { x: LEFT_LANE_X, y: aisleY },
      { x: RIGHT_LANE_X, y: aisleY },
      { x: RIGHT_LANE_X, y: targetY },
      { x: targetX, y: targetY },
    ];
  }

  return [
    ENTRANCE,
    { x: LEFT_LANE_X, y: ENTRANCE.y },
    { x: LEFT_LANE_X, y: aisleY },
    { x: targetX, y: aisleY },
    { x: targetX, y: targetY },
  ];
}

/** Looks up a slot's box: all slots in a zone, sorted by column, indexed into the fixed box list -- exactly how the desktop console matches them up. */
export function boxForIndex(zone: 'block_a' | 'side', indexWithinZone: number): MapBox | undefined {
  return zone === 'side' ? SIDE_BOXES[indexWithinZone] : MAIN_BOXES[indexWithinZone];
}
