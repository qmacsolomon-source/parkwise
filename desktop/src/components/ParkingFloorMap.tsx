import { Slot } from '@parkwise/shared';
import floor1Image from '../assets/floor-maps/floor-1.png';
import floor2Image from '../assets/floor-maps/floor-2.png';
import floor3Image from '../assets/floor-maps/floor-3.png';

interface ParkingFloorMapProps {
  slots: Slot[];
  floor: number;
  onSlotClick: (slot: Slot) => void;
  selectedSlotId?: string | null;
  getSlotTitle?: (slot: Slot) => string | undefined;
}

// Used as the label's own text color now that there's no filled badge
// behind it - "available" needs to read as near-white against the gray
// asphalt art, where the muted gray used for its old badge fill would be
// almost invisible as plain text.
const STATUS_COLORS: Record<string, string> = {
  available: '#f1f5f9',
  reserved: '#f59e0b',
  occupied: '#22c55e',
  unverified: '#ef4444',
  overstay: '#b91c1c',
  maintenance: '#f97316',
};

// Every image is a 1920x1080 export of one floor's actual reference
// drawing, used as-is for the background. The click-zone boxes below were
// hand-drawn directly over the real floor-1 image (one box per real stall,
// via the coordinate-picker tool) rather than estimated from the artwork -
// floors 2 and 3 reuse the exact same box layout on top of their own
// images, since the three floors are the same physical layout and hand-
// marking each one separately isn't worth repeating.
const IMAGE_W = 1920;
const IMAGE_H = 1080;

const FLOOR_IMAGES: Record<number, string> = {
  1: floor1Image,
  2: floor2Image,
  3: floor3Image,
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  pwd: boolean;
}

// 60 stalls, 5 rows of 12 (reading order matches zone_col 1-60 on the
// 'block_a' zone).
const MAIN_BOXES: Box[] = [
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

// 9 stalls along the far wall (reading order matches zone_col 1-9 on the
// 'side' zone).
const SIDE_BOXES: Box[] = [
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

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

function Marker({
  slot,
  isSelected,
  onClick,
  title,
  box,
  label,
}: {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
  title?: string;
  box: Box;
  label: string;
}) {
  const color = STATUS_COLORS[slot.status] || STATUS_COLORS.available;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || slot.slot_code}
      aria-label={`Slot ${slot.slot_code}, ${slot.status}${slot.is_pwd ? ', PWD' : ''}`}
      className="absolute flex items-center justify-center group"
      style={{
        left: pct(box.x, IMAGE_W),
        top: pct(box.y, IMAGE_H),
        width: pct(box.w, IMAGE_W),
        height: pct(box.h, IMAGE_H),
        outline: 'none',
        boxShadow: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        className={`text-[10px] font-semibold leading-none whitespace-nowrap transition-transform group-hover:scale-110 ${
          isSelected ? 'underline decoration-2 underline-offset-2 scale-110' : ''
        }`}
        style={{
          color,
          textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.6)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

export default function ParkingFloorMap({
  slots,
  floor,
  onSlotClick,
  selectedSlotId,
  getSlotTitle,
}: ParkingFloorMapProps) {
  const image = FLOOR_IMAGES[floor] || FLOOR_IMAGES[1];
  const floorSlots = slots.filter((s) => s.floor === floor);

  const byZone = (zone: string) =>
    floorSlots.filter((s) => s.zone === zone).sort((a, b) => a.zone_col - b.zone_col);

  const mainSlots = byZone('block_a');
  const sideSlots = byZone('side');

  if (floorSlots.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400">
        No slots configured for floor {floor}.
      </div>
    );
  }

  // The real slot_code (1A1, 1S4, ...) - this used to be a made-up
  // "floor-spot" sequence (1-1, 1-2, ...) that bore no relationship to the
  // code shown everywhere else the same bay appears (reservation cards,
  // Plate Verification, booking confirmations), so a reservation for "1S5"
  // had no visible slot on this map labelled anything close to that - the
  // attendant had to guess, or count boxes.
  const renderSlot = (slot: Slot, box: Box | undefined) => {
    if (!box) return null;
    return (
      <Marker
        key={slot.id}
        slot={slot}
        isSelected={slot.id === selectedSlotId}
        onClick={() => onSlotClick(slot)}
        title={getSlotTitle?.(slot)}
        box={box}
        label={slot.slot_code}
      />
    );
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto">
      <div className="relative rounded-md overflow-hidden">
        <img
          src={image}
          alt={`Floor ${floor} layout`}
          className="block w-full h-auto select-none"
          style={{ aspectRatio: `${IMAGE_W} / ${IMAGE_H}` }}
          draggable={false}
        />
        <div className="absolute inset-0">
          {mainSlots.map((slot, i) => renderSlot(slot, MAIN_BOXES[i]))}
          {sideSlots.map((slot, i) => renderSlot(slot, SIDE_BOXES[i]))}
        </div>
      </div>
    </div>
  );
}
