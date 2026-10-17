import { Slot } from '@parkwise/shared';
import { ArrowUpDown } from 'lucide-react';

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
// since a 36px map cell needs more contrast than a full-width badge does
// to still read clearly at a glance.
const STATUS_CELL_CLASSES: Record<string, string> = {
  available: 'bg-gray-200 border-gray-400 text-gray-700 hover:bg-gray-300',
  reserved: 'bg-amber-200 border-amber-500 text-amber-900 hover:bg-amber-300',
  occupied: 'bg-green-300 border-green-600 text-green-900 hover:bg-green-400',
  unverified: 'bg-red-300 border-red-600 text-red-900 hover:bg-red-400',
  overstay: 'bg-red-400 border-red-700 text-red-950 hover:bg-red-500',
  maintenance: 'bg-orange-300 border-orange-600 text-orange-900 hover:bg-orange-400',
};

function SlotCell({
  slot,
  isSelected,
  onClick,
  title,
}: {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
  title?: string;
}) {
  const colorClasses = STATUS_CELL_CLASSES[slot.status] || STATUS_CELL_CLASSES.available;
  // Drop the floor digit the code starts with (e.g. "1A7" -> "A7") -
  // which floor we're on is already obvious from the page around it.
  const shortLabel = slot.slot_code.replace(/^\d+/, '');

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || slot.slot_code}
      aria-label={`Slot ${slot.slot_code}, ${slot.status}${slot.is_pwd ? ', PWD' : ''}`}
      className={`w-9 h-9 shrink-0 rounded border-2 flex items-center justify-center text-[10px] font-semibold transition-all hover:scale-110 hover:z-10 relative ${colorClasses} ${
        slot.is_pwd ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      } ${isSelected ? 'ring-2 ring-primary ring-offset-1 scale-110 z-10' : ''}`}
    >
      {shortLabel}
    </button>
  );
}

function DoubleAisleBlock({
  label,
  topRow,
  bottomRow,
  selectedSlotId,
  onSlotClick,
  getSlotTitle,
}: {
  label: string;
  topRow: Slot[];
  bottomRow: Slot[];
  selectedSlotId?: string | null;
  onSlotClick: (slot: Slot) => void;
  getSlotTitle?: (slot: Slot) => string | undefined;
}) {
  const renderRow = (row: Slot[]) => (
    <div className="flex gap-1.5">
      {row.slice(0, 5).map((slot) => (
        <SlotCell
          key={slot.id}
          slot={slot}
          isSelected={slot.id === selectedSlotId}
          onClick={() => onSlotClick(slot)}
          title={getSlotTitle?.(slot)}
        />
      ))}
      {/* Divider gap, matching the support-column/partial-wall split
          visible between sub-blocks in the reference layout. */}
      <div className="w-3 flex items-center justify-center">
        <div className="w-0.5 h-full bg-gray-300" />
      </div>
      {row.slice(5, 10).map((slot) => (
        <SlotCell
          key={slot.id}
          slot={slot}
          isSelected={slot.id === selectedSlotId}
          onClick={() => onSlotClick(slot)}
          title={getSlotTitle?.(slot)}
        />
      ))}
    </div>
  );

  return (
    <div className="border-2 border-gray-300 rounded-lg p-3 bg-white">
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      {renderRow(topRow)}
      <div className="h-5 flex items-center justify-center text-[9px] text-gray-300 uppercase tracking-widest">
        aisle
      </div>
      {renderRow(bottomRow)}
    </div>
  );
}

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

  return (
    <div className="border-4 border-gray-400 rounded-xl p-4 bg-gray-50 flex gap-4 overflow-x-auto">
      <div className="flex-1 flex flex-col gap-4 min-w-[520px]">
        {/* Entrance strip: compact row + elevator/stairs core (a fixed
            landmark, not a parking spot - no data behind it). */}
        <div className="flex gap-4 items-start">
          <div>
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">Compact</p>
            <div className="flex gap-1.5">
              {compact.map((slot) => (
                <SlotCell
                  key={slot.id}
                  slot={slot}
                  isSelected={slot.id === selectedSlotId}
                  onClick={() => onSlotClick(slot)}
                  title={getSlotTitle?.(slot)}
                />
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 px-3 py-2 bg-gray-200 rounded-lg border-2 border-gray-400 text-gray-500">
            <ArrowUpDown size={16} />
            <span className="text-xs font-medium">Elevator / Stairs</span>
          </div>
        </div>

        <DoubleAisleBlock
          label="Block A"
          topRow={blockATop}
          bottomRow={blockABottom}
          selectedSlotId={selectedSlotId}
          onSlotClick={onSlotClick}
          getSlotTitle={getSlotTitle}
        />
        <DoubleAisleBlock
          label="Block B"
          topRow={blockBTop}
          bottomRow={blockBBottom}
          selectedSlotId={selectedSlotId}
          onSlotClick={onSlotClick}
          getSlotTitle={getSlotTitle}
        />
      </div>

      {/* Side column, running the full height along the far wall. */}
      <div className="flex flex-col">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">Side</p>
        <div className="flex-1 border-l-2 border-dashed border-gray-300 pl-3 flex flex-col justify-between gap-1.5">
          {side.map((slot) => (
            <SlotCell
              key={slot.id}
              slot={slot}
              isSelected={slot.id === selectedSlotId}
              onClick={() => onSlotClick(slot)}
              title={getSlotTitle?.(slot)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
