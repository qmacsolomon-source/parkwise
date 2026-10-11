import { SlotStatus, ReservationStatus } from '@parkwise/shared';
import { CheckCircle, Clock, AlertCircle, XCircle, ParkingCircle } from 'lucide-react';

interface StatusBadgeProps {
  status: SlotStatus | ReservationStatus;
  type?: 'slot' | 'reservation';
}

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
  // Slot statuses
  available: { label: 'Available', className: 'status-available', icon: ParkingCircle },
  reserved: { label: 'Reserved', className: 'status-reserved', icon: Clock },
  occupied: { label: 'Occupied', className: 'status-verified', icon: CheckCircle },
  unverified: { label: 'Unverified', className: 'status-unverified', icon: AlertCircle },
  overstay: { label: 'Overstay', className: 'status-overstay', icon: XCircle },
  maintenance: { label: 'Maintenance', className: 'status-available', icon: AlertCircle },
  
  // Reservation statuses
  pending: { label: 'Pending', className: 'status-pending', icon: Clock },
  active: { label: 'Active', className: 'status-reserved', icon: Clock },
  verified: { label: 'Verified', className: 'status-verified', icon: CheckCircle },
  completed: { label: 'Completed', className: 'status-verified', icon: CheckCircle },
  cancelled: { label: 'Cancelled', className: 'status-available', icon: XCircle },
  no_show: { label: 'No Show', className: 'status-overstay', icon: XCircle },
};

export default function StatusBadge({ status, type = 'slot' }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, className: 'status-available', icon: AlertCircle };
  const Icon = config.icon;

  return (
    <span className={`status-badge ${config.className}`}>
      <Icon size={16} />
      {config.label}
    </span>
  );
}
