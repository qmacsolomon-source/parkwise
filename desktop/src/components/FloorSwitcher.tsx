import { ChevronUp, ChevronDown } from 'lucide-react';

interface FloorSwitcherProps {
  floor: number;
  totalFloors: number;
  onChange: (floor: number) => void;
}

export default function FloorSwitcher({ floor, totalFloors, onChange }: FloorSwitcherProps) {
  return (
    <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-card">
      <button
        type="button"
        onClick={() => floor > 1 && onChange(floor - 1)}
        disabled={floor <= 1}
        aria-label="Go down a floor"
        title="Go down a floor"
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronDown size={16} />
      </button>
      <span className="text-sm font-semibold text-gray-700 w-16 text-center select-none">
        Floor {floor}
      </span>
      <button
        type="button"
        onClick={() => floor < totalFloors && onChange(floor + 1)}
        disabled={floor >= totalFloors}
        aria-label="Go up a floor"
        title="Go up a floor"
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronUp size={16} />
      </button>
    </div>
  );
}
