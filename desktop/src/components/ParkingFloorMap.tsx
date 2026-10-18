import type { CSSProperties } from 'react';
import { Slot } from '@parkwise/shared';
import { CornerDownRight, CornerDownLeft, CornerUpLeft, CornerUpRight, ArrowRight, ArrowLeft } from 'lucide-react';

interface ParkingFloorMapProps {
  slots: Slot[];
  floor: number;
  onSlotClick: (slot: Slot) => void;
  selectedSlotId?: string | null;
  // Optional per-slot label shown on hover (e.g. plate + customer) - the
  // map itself matches the reference schematic 1:1, which has no text on
  // individual stalls at all, so the code/status only ever shows on
  // hover/selection; full detail stays in the existing drawer this is
  // wired into.
  getSlotTitle?: (slot: Slot) => string | undefined;
}

// Same status->hue mapping as StatusBadge.tsx. The reference image has no
// color on its stalls (it's a blank template), but the map still has to
// carry live slot status for the attendant, so each stall gets a thin
// color bar instead of a big colored box - keeps the clean line-art look
// while still being readable at a glance.
const STATUS_COLORS: Record<string, string> = {
  available: '#e5e7eb',
  reserved: '#f59e0b',
  occupied: '#22c55e',
  unverified: '#ef4444',
  overstay: '#b91c1c',
  maintenance: '#f97316',
};

// Fixed canvas, pixel-matched to the proportions of the reference
// schematic (one floor's frame from the provided image). Everything below
// is positioned against these constants rather than flex/gap guessing, so
// the layout is a direct copy rather than a reinterpretation.
const W = 820;
const H = 460;
const ROW_START_X = 76;
const ROW_END_X = 714;
const TOP_BASELINE_Y = 120;
const TOP_TICK_Y = 190;
const BOTTOM_BASELINE_Y = 340;
const BOTTOM_TICK_Y = 270;
const SIDE_X = 732;
const SIDE_W = 64;
const SIDE_TOP_Y = 24;
const SIDE_BOTTOM_Y = 436;

function Stall({
  slot,
  isSelected,
  onClick,
  title,
  style,
  horizontal,
}: {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
  title?: string;
  style: CSSProperties;
  horizontal?: boolean;
}) {
  const color = STATUS_COLORS[slot.status] || STATUS_COLORS.available;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || slot.slot_code}
      aria-label={`Slot ${slot.slot_code}, ${slot.status}${slot.is_pwd ? ', PWD' : ''}`}
      style={style}
      className="absolute group flex items-center justify-center"
    >
      <span
        className={`block rounded-sm transition-all group-hover:brightness-110 ${
          horizontal ? 'w-full h-[3px] group-hover:h-[5px]' : 'h-full w-[3px] group-hover:w-[5px]'
        } ${isSelected ? 'ring-2 ring-primary' : ''} ${slot.is_pwd ? 'ring-2 ring-blue-500' : ''}`}
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

// The thick dark bar at each end of a row, matching the support-column /
// partition look in the reference image - spans past both rows and the
// aisle between them.
function EndDivider({ x }: { x: number }) {
  return (
    <div
      className="absolute bg-gray-700 rounded-sm"
      style={{ left: x, top: TOP_BASELINE_Y - 12, width: 6, height: BOTTOM_BASELINE_Y - TOP_BASELINE_Y + 24 }}
    />
  );
}

function StaircaseIcon() {
  return (
    <div
      className="absolute rounded-sm border-2 border-gray-600 bg-gray-200 overflow-hidden shadow-sm"
      style={{ top: 14, right: 14, width: 92, height: 64 }}
      title="Elevator / Stairs"
    >
      <div className="h-3 bg-cyan-400" />
      <div
        className="w-full h-[calc(100%-12px)]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, #9ca3af 0px, #9ca3af 3px, #e5e7eb 3px, #e5e7eb 9px)',
        }}
      />
    </div>
  );
}

const ARROW_CLASS = 'text-yellow-400 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)] pointer-events-none absolute';

export default function ParkingFloorMap({
  slots,
  floor,
  onSlotClick,
  selectedSlotId,
  getSlotTitle,
}: ParkingFloorMapProps) {
  const floorSlots = slots.filter((s) => s.floor === floor);

  const byZone = (zone: string, row?: 'top' | 'bottom') =>
    floorSlots
      .filter((s) => s.zone === zone && (row ? s.zone_row === row : true))
      .sort((a, b) => a.zone_col - b.zone_col);

  const compact = byZone('compact');
  const blockATop = byZone('block_a', 'top');
  const blockABottom = byZone('block_a', 'bottom');
  const blockBTop = byZone('block_b', 'top');
  const blockBBottom = byZone('block_b', 'bottom');
  const side = byZone('side');

  if (floorSlots.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400">
        No slots configured for floor {floor}.
      </div>
    );
  }

  // Top row = compact + block A top + block B top, in that order.
  // Bottom row = block A bottom + block B bottom, column-aligned under the
  // same stalls in the top row (offset past the compact-only columns) -
  // exactly how the aisles line up in a real garage.
  const topRow = [...compact, ...blockATop, ...blockBTop];
  const bottomRow = [...blockABottom, ...blockBBottom];
  const totalCols = topRow.length;
  const bottomOffset = compact.length;
  const colWidth = (ROW_END_X - ROW_START_X) / Math.max(totalCols, 1);

  const stallStyle = (index: number, baselineY: number, tickY: number): CSSProperties => ({
    left: ROW_START_X + index * colWidth,
    width: colWidth,
    top: Math.min(baselineY, tickY),
    height: Math.abs(tickY - baselineY),
  });

  const sideRowHeight = (SIDE_BOTTOM_Y - SIDE_TOP_Y) / Math.max(side.length, 1);

  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-block border-[14px] border-gray-900 rounded-md relative">
        {/* Curb reflector accents on the frame itself. */}
        <div className="absolute top-0 left-10 w-12 h-1.5 bg-yellow-400 -translate-y-full" />
        <div className="absolute bottom-0 left-10 w-12 h-1.5 bg-yellow-400 translate-y-full" />

        <div className="relative bg-gray-400" style={{ width: W, height: H }}>
        {/* Floor number, top-left and bottom-left like painted level markers. */}
        <div className="absolute text-white text-2xl font-extrabold drop-shadow" style={{ left: 18, top: 10 }}>
          {floor}
        </div>
        <div className="absolute text-white text-2xl font-extrabold drop-shadow" style={{ left: 18, top: H - 44 }}>
          {floor}
        </div>

        <StaircaseIcon />

        {/* Row baselines */}
        <div className="absolute bg-gray-100" style={{ left: ROW_START_X, top: TOP_BASELINE_Y, width: ROW_END_X - ROW_START_X, height: 1 }} />
        <div className="absolute bg-gray-100" style={{ left: ROW_START_X, top: BOTTOM_BASELINE_Y, width: ROW_END_X - ROW_START_X, height: 1 }} />

        <EndDivider x={ROW_START_X - 6} />
        <EndDivider x={ROW_END_X} />

        {topRow.map((slot, i) => (
          <Stall
            key={slot.id}
            slot={slot}
            isSelected={slot.id === selectedSlotId}
            onClick={() => onSlotClick(slot)}
            title={getSlotTitle?.(slot)}
            style={stallStyle(i, TOP_BASELINE_Y, TOP_TICK_Y)}
          />
        ))}
        {bottomRow.map((slot, i) => (
          <Stall
            key={slot.id}
            slot={slot}
            isSelected={slot.id === selectedSlotId}
            onClick={() => onSlotClick(slot)}
            title={getSlotTitle?.(slot)}
            style={stallStyle(i + bottomOffset, BOTTOM_BASELINE_Y, BOTTOM_TICK_Y)}
          />
        ))}

        {/* Flow arrows - curved at each end, straight through the middle,
            mirrored between the inbound (top) and outbound (bottom) lanes. */}
        <CornerDownRight size={20} className={ARROW_CLASS} style={{ left: ROW_START_X + 10, top: TOP_BASELINE_Y - 42 }} />
        <ArrowRight size={20} className={ARROW_CLASS} style={{ left: (ROW_START_X + ROW_END_X) / 2 - 10, top: TOP_BASELINE_Y - 42 }} />
        <CornerDownLeft size={20} className={ARROW_CLASS} style={{ left: ROW_END_X - 26, top: TOP_BASELINE_Y - 42 }} />

        <CornerUpLeft size={20} className={ARROW_CLASS} style={{ left: ROW_START_X + 10, top: BOTTOM_BASELINE_Y + 20 }} />
        <ArrowLeft size={20} className={ARROW_CLASS} style={{ left: (ROW_START_X + ROW_END_X) / 2 - 10, top: BOTTOM_BASELINE_Y + 20 }} />
        <CornerUpRight size={20} className={ARROW_CLASS} style={{ left: ROW_END_X - 26, top: BOTTOM_BASELINE_Y + 20 }} />

        {/* Side column - single-loaded ladder of stalls along the far wall. */}
        {side.map((slot, i) => (
          <Stall
            key={slot.id}
            slot={slot}
            isSelected={slot.id === selectedSlotId}
            onClick={() => onSlotClick(slot)}
            title={getSlotTitle?.(slot)}
            horizontal
            style={{ left: SIDE_X, top: SIDE_TOP_Y + i * sideRowHeight, width: SIDE_W, height: sideRowHeight - 4 }}
          />
        ))}
        </div>
      </div>
    </div>
  );
}
