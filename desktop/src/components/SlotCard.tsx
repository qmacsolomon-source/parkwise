import { Slot, AgentState } from '@parkwise/shared';
import StatusBadge from './StatusBadge';
import { Accessibility, MapPin } from 'lucide-react';

interface SlotCardProps {
  slot: Slot;
  agentState?: AgentState;
  onClick?: () => void;
}

export default function SlotCard({ slot, agentState, onClick }: SlotCardProps) {
  return (
    <div
      className="card cursor-pointer hover:shadow-card-hover transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapPin className="text-primary" size={20} />
          <h3 className="text-xl font-bold text-primary">{slot.slot_code}</h3>
        </div>
        {slot.is_pwd && (
          <div className="flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
            <Accessibility size={16} />
            <span className="text-sm font-medium">PWD</span>
          </div>
        )}
      </div>
      
      <div className="flex items-center justify-between">
        <StatusBadge status={slot.status} type="slot" />
        
        {agentState && agentState.state !== 'idle' && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">State:</span> {agentState.state}
          </div>
        )}
      </div>
      
      {agentState?.detected_plate && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-sm">
            <span className="text-gray-600">Detected:</span>
            <span className="font-mono font-bold ml-1">{agentState.detected_plate}</span>
          </div>
          {agentState.confidence && (
            <div className="text-sm text-gray-600">
              Confidence: {Math.round(agentState.confidence * 100)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}
