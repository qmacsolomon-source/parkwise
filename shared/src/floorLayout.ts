// Canonical parking-floor geometry -- SCHEMATIC, 207-bay layout.
//
// The LIVE database is the source of truth for the layout: 3 floors x
// (60 block_a + 9 side) = 207 bays on a 1920x1080 canvas. The database stores
// each bay's rectangle in slots.floor_x / floor_y / floor_w / floor_h + facing
// (see database/live_upgrade/03_floor_plan_207.sql); this file reproduces the
// SAME arithmetic in TypeScript so the phone can still draw the plan before
// that upgrade has been run (the "local" fallback in useFloorPlan.ts).
//
// The drawing is SCHEMATIC: bays sit on a clean grid computed from the slot
// rows, not traced from an image. The repo only has the OLD 34-bay reference
// drawings (assets/floor-maps/floor-{n}.png), which do not match this layout,
// so the phone draws vector shapes instead of a background image.
//
// No bay count is hard-coded: whatever columns/rows the slot data has, they are
// placed on the grid, exactly like the SQL. If you move the facility, change
// the rectangles here AND in 03_floor_plan_207.sql so the two stay in step.

import type { SlotFacing } from './floorPlan';

export const IMAGE_W = 1920;
export const IMAGE_H = 1080;

/** block_a grid rectangle, in canvas px. Mirrors 03_floor_plan_207.sql. */
export const BLOCK_A_RECT = { x0: 150, x1: 1450, y0: 220, y1: 900 };
/** side-column rectangle, in canvas px. Mirrors 03_floor_plan_207.sql. */
export const SIDE_RECT = { x0: 1560, x1: 1680, y0: 220, y1: 980 };
/** Gap between block A's two rows (the cross aisle). */
export const ROW_AISLE = 140;
/** Depth used when block_a has only a single row. */
export const SINGLE_ROW_DEPTH = 200;

export interface SlotGeometry {
  floor_x: number;
  floor_y: number;
  floor_w: number;
  floor_h: number;
  facing: SlotFacing;
}

/** The minimum a slot must carry for the schematic layout to place it. */
export interface SchematicSlotInput {
  floor: number;
  zone: string;
  zone_row: string | null;
  zone_col: number;
}

/** Map key for one bay. Matches the columns the database keys geometry on. */
export function schematicKey(
  floor: number,
  zone: string,
  zoneRow: string | null,
  zoneCol: number
): string {
  return `${floor}|${zone}|${zoneRow ?? ''}|${zoneCol}`;
}

/**
 * Build the schematic rect for every slot, derived from the slot rows
 * themselves -- exactly what 03_floor_plan_207.sql does, so the phone and the
 * database agree. Keyed by `schematicKey(floor, zone, zone_row, zone_col)`.
 */
export function buildSchematicGeometry(
  slots: SchematicSlotInput[]
): Map<string, SlotGeometry> {
  const out = new Map<string, SlotGeometry>();
  const floors = Array.from(new Set(slots.map((s) => s.floor))).sort((a, b) => a - b);

  for (const floor of floors) {
    const floorSlots = slots.filter((s) => s.floor === floor);

    // ---- block_a: a grid, rows x columns, both read from the data ----------
    const blockA = floorSlots.filter((s) => s.zone === 'block_a');
    const cols = Array.from(new Set(blockA.map((s) => s.zone_col))).sort((a, b) => a - b);

    if (cols.length > 0) {
      // 'top' row first, then 'bottom' -- a plain sort would flip them.
      const rows = Array.from(new Set(blockA.map((s) => s.zone_row ?? 'top'))).sort(
        (a, b) => (a === 'top' ? 0 : 1) - (b === 'top' ? 0 : 1) || a.localeCompare(b)
      );

      const bayW = (BLOCK_A_RECT.x1 - BLOCK_A_RECT.x0) / cols.length;
      const rowH =
        rows.length >= 2
          ? (BLOCK_A_RECT.y1 - BLOCK_A_RECT.y0 - ROW_AISLE) / rows.length
          : SINGLE_ROW_DEPTH;

      rows.forEach((rowLabel, i) => {
        const y =
          rows.length >= 2
            ? i === 0
              ? BLOCK_A_RECT.y0
              : BLOCK_A_RECT.y1 - rowH
            : BLOCK_A_RECT.y0;
        const facing: SlotFacing =
          rows.length >= 2 ? (i === 0 ? 'down' : 'up') : 'down';

        cols.forEach((col, j) => {
          out.set(schematicKey(floor, 'block_a', rowLabel, col), {
            floor_x: BLOCK_A_RECT.x0 + j * bayW,
            floor_y: y,
            floor_w: bayW,
            floor_h: rowH,
            facing,
          });
        });
      });
    }

    // ---- side: a single column of bays on the right, opening left ----------
    const side = floorSlots.filter((s) => s.zone === 'side');
    const sideCols = Array.from(new Set(side.map((s) => s.zone_col))).sort((a, b) => a - b);

    if (sideCols.length > 0) {
      const bayH = (SIDE_RECT.y1 - SIDE_RECT.y0) / sideCols.length;

      sideCols.forEach((col, j) => {
        out.set(schematicKey(floor, 'side', null, col), {
          floor_x: SIDE_RECT.x0,
          floor_y: SIDE_RECT.y0 + j * bayH,
          floor_w: SIDE_RECT.x1 - SIDE_RECT.x0,
          floor_h: bayH,
          facing: 'left',
        });
      });
    }
  }

  return out;
}

/**
 * Default drive aisle, in the same 1920x1080 space. Mirrors the DEFAULT row in
 * 03_floor_plan_207.sql: enter bottom-right, up the trunk lane, then along the
 * cross lane between block A's two rows. A row in `facility_layout` overrides
 * this at runtime.
 */
export const DEFAULT_ENTRANCE = { x: 1505, y: 1005 };

export const DEFAULT_AISLE = {
  entrance: DEFAULT_ENTRANCE,
  trunk: { x: 1505, y0: 560, y1: 1005 },
  crossLane: { y: 560, x0: 150, x1: 1505 },
};
