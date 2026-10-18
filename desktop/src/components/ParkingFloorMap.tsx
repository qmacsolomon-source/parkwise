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

const STATUS_COLORS: Record<string, string> = {
  available: '#9ca3af',
  reserved: '#f59e0b',
  occupied: '#22c55e',
  unverified: '#ef4444',
  overstay: '#b91c1c',
  maintenance: '#f97316',
};

// Every image is a 1920x1080 export of one floor's actual reference
// drawing, used as-is for the background - this is the floor, not a
// redraw of it. Everything below is a set of click-zone coordinates
// measured directly off each image's pixels (divider positions, tick
// centers, side-column spacing), expressed as % of the 1920x1080 canvas
// so they stay aligned regardless of the displayed size.
const IMAGE_W = 1920;
const IMAGE_H = 1080;

interface FloorLayout {
  image: string;
  topRowY: [number, number];
  bottomRowY: [number, number];
  bayCentersX: number[]; // 12 main-row stall centers, shared by top and bottom rows
  sideX: [number, number];
  sideCentersY: number[]; // 10 side-column stall centers
}

const FLOOR_LAYOUTS: Record<number, FloorLayout> = {
  1: {
    image: floor1Image,
    topRowY: [375, 565],
    bottomRowY: [693, 883],
    bayCentersX: [475, 547, 623, 698, 774, 849, 925, 1001, 1076, 1152, 1227, 1301],
    sideX: [1536, 1660],
    sideCentersY: [273, 348, 424, 499, 575, 651, 726, 802, 877, 953],
  },
  2: {
    image: floor2Image,
    topRowY: [378, 565],
    bottomRowY: [690, 877],
    bayCentersX: [482, 553, 628, 702, 777, 851, 925, 1000, 1074, 1148, 1223, 1295],
    sideX: [1527, 1654],
    sideCentersY: [277, 351, 426, 500, 574, 649, 723, 798, 872, 946],
  },
  3: {
    image: floor3Image,
    topRowY: [380, 565],
    bottomRowY: [689, 874],
    bayCentersX: [487, 557, 631, 704, 778, 851, 925, 999, 1072, 1146, 1219, 1291],
    sideX: [1521, 1649],
    sideCentersY: [280, 354, 427, 501, 575, 648, 722, 796, 869, 943],
  },
};

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

function Marker({
  slot,
  isSelected,
  onClick,
  title,
  left,
  top,
  width,
  height,
}: {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
  title?: string;
  left: string;
  top: string;
  width: string;
  height: string;
}) {
  const color = STATUS_COLORS[slot.status] || STATUS_COLORS.available;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || slot.slot_code}
      aria-label={`Slot ${slot.slot_code}, ${slot.status}${slot.is_pwd ? ', PWD' : ''}`}
      className="absolute flex items-center justify-center group"
      style={{ left, top, width, height }}
    >
      <span
        className={`block w-[55%] h-[55%] rounded-full transition-transform group-hover:scale-125 ${
          isSelected ? 'ring-2 ring-primary ring-offset-1' : ''
        } ${slot.is_pwd ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
        style={{ backgroundColor: color, opacity: slot.status === 'available' ? 0.45 : 0.9 }}
      />
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
  const layout = FLOOR_LAYOUTS[floor] || FLOOR_LAYOUTS[1];
  const floorSlots = slots.filter((s) => s.floor === floor);

  const byZone = (zone: string, row?: 'top' | 'bottom') =>
    floorSlots
      .filter((s) => s.zone === zone && (row ? s.zone_row === row : true))
      .sort((a, b) => a.zone_col - b.zone_col);

  const topRow = byZone('block_a', 'top');
  const bottomRow = byZone('block_a', 'bottom');
  const side = byZone('side');

  if (floorSlots.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400">
        No slots configured for floor {floor}.
      </div>
    );
  }

  const bayWidth = 60; // px at native 1920 resolution
  const sideHeight = 50;

  const renderRow = (row: Slot[], yRange: [number, number]) =>
    row.map((slot, i) => {
      const cx = layout.bayCentersX[i];
      if (cx === undefined) return null;
      return (
        <Marker
          key={slot.id}
          slot={slot}
          isSelected={slot.id === selectedSlotId}
          onClick={() => onSlotClick(slot)}
          title={getSlotTitle?.(slot)}
          left={pct(cx - bayWidth / 2, IMAGE_W)}
          top={pct(yRange[0], IMAGE_H)}
          width={pct(bayWidth, IMAGE_W)}
          height={pct(yRange[1] - yRange[0], IMAGE_H)}
        />
      );
    });

  return (
    <div className="max-w-full overflow-x-auto">
      <div className="relative inline-block rounded-md overflow-hidden" style={{ width: 820 }}>
        <img src={layout.image} alt={`Floor ${floor} layout`} className="block w-full h-auto select-none" draggable={false} />
        <div className="absolute inset-0" style={{ aspectRatio: `${IMAGE_W} / ${IMAGE_H}` }}>
          {renderRow(topRow, layout.topRowY)}
          {renderRow(bottomRow, layout.bottomRowY)}
          {side.map((slot, i) => {
            const cy = layout.sideCentersY[i];
            if (cy === undefined) return null;
            return (
              <Marker
                key={slot.id}
                slot={slot}
                isSelected={slot.id === selectedSlotId}
                onClick={() => onSlotClick(slot)}
                title={getSlotTitle?.(slot)}
                left={pct(layout.sideX[0], IMAGE_W)}
                top={pct(cy - sideHeight / 2, IMAGE_H)}
                width={pct(layout.sideX[1] - layout.sideX[0], IMAGE_W)}
                height={pct(sideHeight, IMAGE_H)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
