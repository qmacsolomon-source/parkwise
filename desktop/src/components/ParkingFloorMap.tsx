import { Slot } from '@parkwise/shared';
import {
  ArrowUpDown,
  ArrowRight,
  ArrowLeft,
  CornerDownRight,
  CornerDownLeft,
  CornerUpLeft,
  CornerUpRight,
} from 'lucide-react';

interface ParkingFloorMapProps {
  slots: Slot[];
  floor: number;
  onSlotClick: (slot: Slot) => void;
  selectedSlotId?: string | null;
  // Optional per-slot label shown on hover (e.g. plate + customer) -
  // the map itself only ever shows the slot code, there's no room for
  // more at this size; full detail stays in the existing slot drawer /
  // selection flow this is wired into.
  getSlotTitle?: (slot: Slot) => string | undefined;
}

// Same hue mapping as StatusBadge.tsx, just a shade or two more saturated
// since a small map cell needs more contrast than a full-width badge does
// to still read clearly at a glance against the gray "asphalt" background.
const STATUS_CELL_CLASSES: Record<string, string> = {
  available: 'bg-gray-100 border-gray-400 text-gray-600 hover:bg-white',
  reserved: 'bg-amber-300 border-amber-600 text-amber-900 hover:bg-amber-400',
  occupied: 'bg-green-400 border-green-700 text-green-950 hover:bg-green-500',
  unverified: 'bg-red-400 border-red-700 text-red-950 hover:bg-red-500',
  overstay: 'bg-red-500 border-red-800 text-white hover:bg-red-600',
  maintenance: 'bg-orange-400 border-orange-700 text-orange-950 hover:bg-orange-500',
};

function Stall({
  slot,
  isSelected,
  onClick,
  title,
  horizontal,
}: {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
  title?: string;
  horizontal?: boolean;
}) {
  const colorClasses = STATUS_CELL_CLASSES[slot.status] || STATUS_CELL_CLASSES.available;
  // Drop the floor digit the code starts with (e.g. "1A7" -> "A7") -
  // which floor we're on is already obvious from the corner badges.
  const shortLabel = slot.slot_code.replace(/^\d+/, '');

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || slot.slot_code}
      aria-label={`Slot ${slot.slot_code}, ${slot.status}${slot.is_pwd ? ', PWD' : ''}`}
      className={`shrink-0 border-2 flex items-center justify-center font-semibold transition-all hover:scale-105 hover:z-10 relative ${
        horizontal ? 'w-16 h-6 text-[9px] rounded-sm' : 'w-7 h-14 text-[9px] rounded-sm items-end pb-0.5'
      } ${colorClasses} ${slot.is_pwd ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${
        isSelected ? 'ring-2 ring-primary ring-offset-1 scale-105 z-10' : ''
      }`}
    >
      {shortLabel}
    </button>
  );
}

// The thicker vertical bar marking a support column / aisle entry point -
// the gap between the stall rows and the drive lane in the reference sketch.
function Divider() {
  return <div className="w-1.5 self-stretch bg-gray-700/70 rounded-sm shrink-0" />;
}

function ElevatorStairsIcon() {
  return (
    <div className="absolute top-3 right-3 w-20 h-14 rounded-sm border-2 border-gray-600 bg-gray-200 overflow-hidden shadow-sm flex flex-col">
      <div className="h-2 bg-cyan-400 shrink-0" />
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <ArrowUpDown size={18} />
      </div>
    </div>
  );
}

const ARROW_CLASS = 'text-yellow-400 drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)] pointer-events-none';

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

  const renderSlot = (slot: Slot) => (
    <Stall
      key={slot.id}
      slot={slot}
      isSelected={slot.id === selectedSlotId}
      onClick={() => onSlotClick(slot)}
      title={getSlotTitle?.(slot)}
    />
  );

  return (
    <div className="relative border-[10px] border-gray-900 rounded-md bg-gray-400 px-5 pt-16 pb-5 overflow-x-auto select-none">
      {/* Curb reflector accents at the near-side corners, matching the
          reference sketch's yellow corner marks. */}
      <div className="absolute top-0 left-10 w-12 h-1.5 bg-yellow-400" />
      <div className="absolute bottom-0 left-10 w-12 h-1.5 bg-yellow-400" />

      {/* Floor number, shown top-left and bottom-left like a real garage's
          painted level markers. */}
      <div className="absolute top-3 left-4 text-white text-2xl font-extrabold drop-shadow">{floor}</div>
      <div className="absolute bottom-3 left-4 text-white text-2xl font-extrabold drop-shadow">{floor}</div>

      <ElevatorStairsIcon />

      {/* Entrance strip: compact/PWD stalls, tucked near the elevator core
          same as before - just restyled to drop the boxed label. */}
      <div className="flex gap-1 mb-6 ml-10">{compact.map(renderSlot)}</div>

      <div className="flex gap-5 min-w-[760px]">
        <div className="flex-1 flex flex-col gap-6 pb-10">
          {/* Top row + inbound flow arrows */}
          <div className="relative flex items-end gap-2 pt-7">
            <div className="absolute -top-1 left-2">
              <CornerDownRight size={18} className={ARROW_CLASS} />
            </div>
            <div className="absolute -top-1 left-1/2 -translate-x-1/2">
              <ArrowRight size={18} className={ARROW_CLASS} />
            </div>
            <div className="absolute -top-1 right-2">
              <CornerDownLeft size={18} className={ARROW_CLASS} />
            </div>

            <Divider />
            <div className="flex gap-1">{blockATop.map(renderSlot)}</div>
            <div className="flex gap-1">{blockBTop.map(renderSlot)}</div>
            <Divider />
          </div>

          {/* Drive aisle */}
          <div className="h-px bg-gray-200/70 mx-2" />

          {/* Bottom row + outbound flow arrows */}
          <div className="relative flex items-start gap-2 pb-7">
            <Divider />
            <div className="flex gap-1">{blockABottom.map(renderSlot)}</div>
            <div className="flex gap-1">{blockBBottom.map(renderSlot)}</div>
            <Divider />

            <div className="absolute -bottom-1 left-2">
              <CornerUpLeft size={18} className={ARROW_CLASS} />
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
              <ArrowLeft size={18} className={ARROW_CLASS} />
            </div>
            <div className="absolute -bottom-1 right-2">
              <CornerUpRight size={18} className={ARROW_CLASS} />
            </div>
          </div>
        </div>

        {/* Side column, running the full height along the far wall as a
            single-loaded ladder of stalls, no box/label like the sketch. */}
        <div className="flex flex-col justify-between gap-1.5 py-1 pl-4 border-l border-gray-300/60">
          {side.map((slot) => (
            <Stall
              key={slot.id}
              slot={slot}
              isSelected={slot.id === selectedSlotId}
              onClick={() => onSlotClick(slot)}
              title={getSlotTitle?.(slot)}
              horizontal
            />
          ))}
        </div>
      </div>
    </div>
  );
}
