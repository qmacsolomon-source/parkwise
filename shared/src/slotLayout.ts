import { Slot } from './types';

// A plain `.order('slot_code')` sorts "1A10" before "1A2" (string order,
// not numeric), and with no order at all Postgres returns slots.select()
// rows in arbitrary physical order -- either way, a flat <select> of all
// 168 slots comes out looking shuffled. This sorts the way someone
// reading the actual floor map would expect to: by floor, then by walking
// through the map itself (compact row, block A's top then bottom row,
// block B's top then bottom row, then the side column), each left to
// right / top to bottom.
const ZONE_ORDER: Record<string, number> = { compact: 0, block_a: 1, block_b: 2, side: 3 };
const ROW_ORDER: Record<string, number> = { top: 0, bottom: 1 };

export function sortSlotsForDisplay(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => {
    if (a.floor !== b.floor) return a.floor - b.floor;
    const zoneDiff = (ZONE_ORDER[a.zone] ?? 99) - (ZONE_ORDER[b.zone] ?? 99);
    if (zoneDiff !== 0) return zoneDiff;
    const rowDiff = (a.zone_row ? ROW_ORDER[a.zone_row] ?? 0 : 0) - (b.zone_row ? ROW_ORDER[b.zone_row] ?? 0 : 0);
    if (rowDiff !== 0) return rowDiff;
    return a.zone_col - b.zone_col;
  });
}

export interface SlotFloorGroup {
  floor: number;
  slots: Slot[];
}

// Same sort, bucketed by floor -- what a <select> with <optgroup> sections
// needs.
export function groupSlotsByFloor(slots: Slot[]): SlotFloorGroup[] {
  const sorted = sortSlotsForDisplay(slots);
  const byFloor = new Map<number, Slot[]>();
  for (const slot of sorted) {
    const bucket = byFloor.get(slot.floor);
    if (bucket) {
      bucket.push(slot);
    } else {
      byFloor.set(slot.floor, [slot]);
    }
  }
  return Array.from(byFloor.entries())
    .sort(([a], [b]) => a - b)
    .map(([floor, floorSlots]) => ({ floor, slots: floorSlots }));
}
