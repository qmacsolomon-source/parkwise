// Tiny Node test for shared/src/floorPlan.ts + shared/src/floorLayout.ts.
// Run with:
//   node --experimental-strip-types test/floor-plan.test.mjs
// No test framework, no build step: it type-strips the .ts source directly.
//
// The layout under test is the LIVE one: 207 bays = 3 floors x (60 block_a +
// 9 side). It mirrors database/live_upgrade/03_floor_plan_207.sql.
import assert from 'node:assert/strict';
import {
  computeRoute,
  describeDirections,
  describeRouteShort,
  getAccessPoint,
  pointAlongRoute,
  primaryDirection,
  routeLength,
  ordinal,
} from '../src/floorPlan.ts';
import {
  BLOCK_A_RECT,
  IMAGE_H,
  IMAGE_W,
  SIDE_RECT,
  buildSchematicGeometry,
  schematicKey,
} from '../src/floorLayout.ts';

// The `aisle` JSONB default from 03_floor_plan_207.sql / floorLayout.ts.
const layout = {
  canvas_width: IMAGE_W,
  canvas_height: IMAGE_H,
  entrance_x: 1505,
  entrance_y: 1005,
  aisle: {
    entrance: { x: 1505, y: 1005 },
    trunk: { x: 1505, y0: 560, y1: 1005 },
    crossLane: { y: 560, x0: 150, x1: 1505 },
  },
};

// --- the live 207-slot inventory -------------------------------------------
const slots = [];
for (let floor = 1; floor <= 3; floor += 1) {
  for (const row of ['top', 'bottom']) {
    for (let col = 1; col <= 30; col += 1) {
      slots.push({ floor, zone: 'block_a', zone_row: row, zone_col: col });
    }
  }
  for (let col = 1; col <= 9; col += 1) {
    slots.push({ floor, zone: 'side', zone_row: null, zone_col: col });
  }
}
assert.equal(slots.length, 207, 'the live layout is 207 bays');

const geo = buildSchematicGeometry(slots);
assert.equal(geo.size, 207, 'every bay gets a rectangle');
assert.equal(
  [...geo.keys()].filter((k) => k.startsWith('1|block_a')).length,
  60,
  '60 block_a bays on floor 1'
);
assert.equal(
  [...geo.keys()].filter((k) => k.startsWith('1|side')).length,
  9,
  '9 side bays on floor 1'
);

const bayW = (BLOCK_A_RECT.x1 - BLOCK_A_RECT.x0) / 30;
const rowH = (BLOCK_A_RECT.y1 - BLOCK_A_RECT.y0 - 140) / 2;
const sideH = (SIDE_RECT.y1 - SIDE_RECT.y0) / 9;

// Column 1 sits at the left edge of block A; column 30 at the right edge.
assert.deepEqual(
  geo.get(schematicKey(1, 'block_a', 'top', 1)),
  { floor_x: BLOCK_A_RECT.x0, floor_y: BLOCK_A_RECT.y0, floor_w: bayW, floor_h: rowH, facing: 'down' },
  "block A's top row starts at the top-left and opens downwards"
);
assert.deepEqual(
  geo.get(schematicKey(1, 'block_a', 'bottom', 30)),
  {
    floor_x: BLOCK_A_RECT.x0 + 29 * bayW,
    floor_y: BLOCK_A_RECT.y1 - rowH,
    floor_w: bayW,
    floor_h: rowH,
    facing: 'up',
  },
  "block A's bottom row runs along the bottom and opens upwards"
);
assert.deepEqual(
  geo.get(schematicKey(1, 'side', null, 1)),
  { floor_x: SIDE_RECT.x0, floor_y: SIDE_RECT.y0, floor_w: SIDE_RECT.x1 - SIDE_RECT.x0, floor_h: sideH, facing: 'left' },
  'the side column starts at the top and opens to its left'
);

// A plain alphabetical sort would put "bottom" first and flip the two rows.
const topY = geo.get(schematicKey(1, 'block_a', 'top', 1)).floor_y;
const bottomY = geo.get(schematicKey(1, 'block_a', 'bottom', 1)).floor_y;
assert.ok(topY < bottomY, "'top' really is the upper row");

// No bay count is hard-coded: a 5-column floor lays itself out on the same grid.
const tiny = buildSchematicGeometry([
  { floor: 1, zone: 'block_a', zone_row: 'top', zone_col: 1 },
  { floor: 1, zone: 'block_a', zone_row: 'bottom', zone_col: 1 },
  { floor: 1, zone: 'block_a', zone_row: 'top', zone_col: 2 },
  { floor: 1, zone: 'block_a', zone_row: 'bottom', zone_col: 2 },
  { floor: 1, zone: 'block_a', zone_row: 'top', zone_col: 3 },
  { floor: 1, zone: 'block_a', zone_row: 'bottom', zone_col: 3 },
  { floor: 1, zone: 'block_a', zone_row: 'top', zone_col: 4 },
  { floor: 1, zone: 'block_a', zone_row: 'bottom', zone_col: 4 },
  { floor: 1, zone: 'block_a', zone_row: 'top', zone_col: 5 },
  { floor: 1, zone: 'block_a', zone_row: 'bottom', zone_col: 5 },
]);
assert.equal(tiny.get(schematicKey(1, 'block_a', 'top', 1)).floor_w, (BLOCK_A_RECT.x1 - BLOCK_A_RECT.x0) / 5);
assert.equal(tiny.get(schematicKey(1, 'block_a', 'top', 6)), undefined, 'no bay 6 exists');

// --- access points ---------------------------------------------------------
const topSlot = {
  slot_id: 'a', slot_code: '1A1', is_pwd: false, floor: 1,
  zone: 'block_a', zone_row: 'top', zone_col: 1,
  ...geo.get(schematicKey(1, 'block_a', 'top', 1)),
  entry_rank: 5, availability: 'available',
};
const bottomSlot = {
  slot_id: 'b', slot_code: '1A31', is_pwd: false, floor: 1,
  zone: 'block_a', zone_row: 'bottom', zone_col: 1,
  ...geo.get(schematicKey(1, 'block_a', 'bottom', 1)),
  entry_rank: 20, availability: 'available',
};
const sideSlot = {
  slot_id: 'c', slot_code: '1S1', is_pwd: false, floor: 1,
  zone: 'side', zone_row: null, zone_col: 1,
  ...geo.get(schematicKey(1, 'side', null, 1)),
  entry_rank: 1, availability: 'available',
};

assert.deepEqual(
  getAccessPoint(topSlot),
  { x: topSlot.floor_x + bayW / 2, y: topSlot.floor_y + rowH },
  'the top row opens downwards'
);
assert.deepEqual(
  getAccessPoint(bottomSlot),
  { x: bottomSlot.floor_x + bayW / 2, y: bottomSlot.floor_y },
  'the bottom row opens upwards'
);
assert.deepEqual(
  getAccessPoint(sideSlot),
  { x: SIDE_RECT.x0, y: sideSlot.floor_y + sideH / 2 },
  'the side column opens to its left'
);

// --- routes ----------------------------------------------------------------
const topRoute = computeRoute(layout, topSlot);
assert.deepEqual(topRoute, [
  { x: 1505, y: 1005 },                              // entrance
  { x: 1505, y: 560 },                               // up the trunk lane
  { x: topSlot.floor_x + bayW / 2, y: 560 },         // left along the cross lane
  { x: topSlot.floor_x + bayW / 2, y: topSlot.floor_y + rowH }, // into the bay
]);

const sideRoute = computeRoute(layout, sideSlot);
assert.deepEqual(sideRoute, [
  { x: 1505, y: 1005 },
  { x: 1505, y: sideSlot.floor_y + sideH / 2 },
  { x: SIDE_RECT.x0, y: sideSlot.floor_y + sideH / 2 },
]);

assert.ok(routeLength(topRoute) > 0, 'the route has a length');

// A bay with no geometry still yields a usable route (entrance -> bay corner).
const flat = computeRoute(layout, {
  ...topSlot, floor_x: null, floor_y: null, floor_w: null, floor_h: null,
});
assert.ok(flat.length >= 2, 'missing geometry still yields entrance -> access point');

// --- direction summary -----------------------------------------------------
assert.equal(primaryDirection(layout, topSlot), 'left', 'Block A bays sit left of the trunk');
assert.equal(primaryDirection(layout, sideSlot), 'straight', 'the side column needs no turn');

// --- human directions ------------------------------------------------------
const topSteps = describeDirections(layout, topSlot);
assert.equal(topSteps.length, 4);
assert.match(topSteps[0], /Enter/);
assert.match(topSteps[1], /turn left/i);
assert.match(topSteps[2], /1A1 is on your right/);
assert.ok(!/\d+(st|nd|rd|th) bay/.test(topSteps[2]), 'no "Nth bay" arithmetic for a 60-bay row');
assert.match(topSteps[3], /5th closest/);

const bottomSteps = describeDirections(layout, bottomSlot);
assert.match(bottomSteps[2], /1A31 is on your left/);

const sideSteps = describeDirections(layout, sideSlot);
assert.match(sideSteps[2], /1S1 is on your right/);

assert.equal(describeRouteShort(layout, topSlot), 'Turn left at Block A, then 1A1 on your right');
assert.equal(describeRouteShort(layout, sideSlot), 'Straight to the far wall, then 1S1 on your right');

// Ordinals must keep working past the old 20-item table (a row can hold 60).
assert.equal(ordinal(1), '1st');
assert.equal(ordinal(2), '2nd');
assert.equal(ordinal(3), '3rd');
assert.equal(ordinal(11), '11th');
assert.equal(ordinal(12), '12th');
assert.equal(ordinal(13), '13th');
assert.equal(ordinal(21), '21st');
assert.equal(ordinal(22), '22nd');
assert.equal(ordinal(53), '53rd');
assert.equal(ordinal(111), '111th');

// --- travelling marker -----------------------------------------------------
assert.deepEqual(pointAlongRoute(topRoute, 0), { x: 1505, y: 1005 }, 'starts at the entrance');
assert.deepEqual(pointAlongRoute(topRoute, 1), getAccessPoint(topSlot), 'ends in the bay');
const halfway = pointAlongRoute(topRoute, 0.5);
assert.ok(
  halfway.x === 1505 || halfway.y === 560 || halfway.x === topSlot.floor_x + bayW / 2,
  'halfway is on the polyline'
);

console.log('floorPlan: all assertions passed');
