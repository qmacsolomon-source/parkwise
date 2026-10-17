import { ChevronUp, ChevronDown, Layers } from 'lucide-react';

interface FloorSwitcherProps {
  floor: number;
  totalFloors: number;
  onChange: (floor: number) => void;
}

export default function FloorSwitcher({ floor, totalFloors, onChange }: FloorSwitcherProps) {
  const floors = Array.from({ length: totalFloors }, (_, i) => totalFloors - i); // top floor first, like a real panel

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-card">
      <Layers size={18} className="text-gray-400" aria-hidden="true" />
      <div className="flex items-center gap-1" role="tablist" aria-label="Select floor">
        {floors.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={f === floor}
            onClick={() => f !== floor && onChange(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              f === floor
                ? 'bg-primary text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Floor {f}
          </button>
        ))}
      </div>
      <div className="flex flex-col border-l border-gray-200 pl-2 ml-1">
        <button
          type="button"
          onClick={() => floor < totalFloors && onChange(floor + 1)}
          disabled={floor >= totalFloors}
          aria-label="Go up a floor"
          title="Go up a floor"
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          onClick={() => floor > 1 && onChange(floor - 1)}
          disabled={floor <= 1}
          aria-label="Go down a floor"
          title="Go down a floor"
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </div>
  );
}
