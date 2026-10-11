import { Reservation, Profile, Vehicle } from '@parkwise/shared';
import StatusBadge from './StatusBadge';
import { Calendar, Clock, Car, User as UserIcon, Ticket } from 'lucide-react';
import { format } from 'date-fns';

interface ReservationCardProps {
  reservation: Reservation;
  customer?: Profile;
  vehicle?: Vehicle;
  onClick?: () => void;
}

export default function ReservationCard({ reservation, customer, vehicle, onClick }: ReservationCardProps) {
  return (
    <div
      className="card cursor-pointer hover:shadow-card-hover transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Ticket className="text-accent" size={20} />
          <h3 className="text-lg font-bold text-primary">{reservation.booking_code}</h3>
        </div>
        <StatusBadge status={reservation.status} type="reservation" />
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-700">
          <UserIcon size={16} />
          <span>{customer?.full_name || 'Unknown'}</span>
        </div>
        
        <div className="flex items-center gap-2 text-gray-700">
          <Car size={16} />
          <span className="font-mono">{vehicle?.plate_number || 'Unknown'}</span>
        </div>
        
        <div className="flex items-center gap-2 text-gray-700">
          <Calendar size={16} />
          <span>{format(new Date(reservation.start_time), 'MMM dd, yyyy')}</span>
        </div>
        
        <div className="flex items-center gap-2 text-gray-700">
          <Clock size={16} />
          <span>
            {format(new Date(reservation.start_time), 'HH:mm')} - {format(new Date(reservation.end_time), 'HH:mm')}
          </span>
        </div>
      </div>
    </div>
  );
}
