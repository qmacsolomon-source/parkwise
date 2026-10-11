import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot } from '@parkwise/shared';
import {
  FileText, AlertTriangle, CheckCircle, LogOut, Bell,
  Trash2, Clock, Car, User, Phone, MapPin
} from 'lucide-react';

const AGENT_SERVICE_URL = 'http://localhost:8000';

interface ManualEntry {
  id: string;
  plate: string;
  vehicleType: string;
  customerName: string | null;
  customerPhone: string | null;
  slot: string;
  slotId: string;
  timeIn: string;
  duration: number;
  hasPwdPermit: boolean;
  reason: string;
  attendant: string;
  createdAt: string;
  status: 'active' | 'voided';
}

export default function ManualEntry() {
  const { profile, logout } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [recentEntries, setRecentEntries] = useState<ManualEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Form state
  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('four_wheeled');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [timeIn, setTimeIn] = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState(1);
  const [hasPwdPermit, setHasPwdPermit] = useState(false);
  const [reason, setReason] = useState('');

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadSlots();
    loadRecentEntries();
  }, []);

  const loadSlots = async () => {
    try {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('status', 'available');

      if (error) throw error;
      setSlots(data || []);
    } catch (error) {
      console.error('Error loading slots:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentEntries = async () => {
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('action', 'manual_entry')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      const entries: ManualEntry[] = (data || []).map((item: any) => ({
        id: item.id,
        plate: item.details.plate,
        vehicleType: item.details.vehicle_type,
        customerName: item.details.customer_name || null,
        customerPhone: item.details.customer_phone || null,
        slot: item.details.slot_code,
        slotId: item.details.slot_id,
        timeIn: item.details.time_in,
        duration: item.details.duration,
        hasPwdPermit: item.details.has_pwd_permit,
        reason: item.details.reason,
        attendant: item.actor_id,
        createdAt: item.created_at,
        status: item.details.status || 'active',
      }));

      setRecentEntries(entries);
    } catch (error) {
      console.error('Error loading recent entries:', error);
    }
  };

  const validatePlateNumber = (plate: string): boolean => {
    // Philippine plate format: 3 letters + 3 numbers (e.g., ABC123)
    // or 3 letters + 3 numbers + 2 letters (e.g., ABC123XY)
    const regex = /^[A-Z]{3}\d{3}([A-Z]{2})?$/;
    return regex.test(plate.toUpperCase());
  };

  const validateForm = (): boolean => {
    if (!plateNumber) {
      setError('Plate number is required');
      return false;
    }

    if (!validatePlateNumber(plateNumber)) {
      setError('Invalid plate format. Use format: ABC123 or ABC123XY');
      return false;
    }

    if (vehicleType !== 'four_wheeled') {
      setError('Only four-wheeled vehicles are allowed');
      return false;
    }

    if (!selectedSlot) {
      setError('Please select a slot');
      return false;
    }

    if (!timeIn) {
      setError('Time in is required');
      return false;
    }

    if (duration <= 0) {
      setError('Duration must be greater than 0');
      return false;
    }

    if (hasPwdPermit) {
      const slot = slots.find(s => s.id === selectedSlot);
      if (!slot?.is_pwd) {
        setError('PWD permit is only valid for PWD slots');
        return false;
      }
    }

    if (!reason.trim()) {
      setError('Reason is required for manual entry');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Create a walk-in customer profile if needed
      let customerId: string;
      if (customerName && customerPhone) {
        // Check if customer exists by phone
        const { data: existingCustomer } = await supabase
          .from('profiles')
          .select('*')
          .eq('phone', customerPhone)
          .single();

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          // Create new customer
          const { data: newCustomer, error: customerError } = await supabase
            .from('profiles')
            .insert({
              full_name: customerName,
              email: `${customerPhone}@walkin.parkwise.local`,
              phone: customerPhone,
              role: 'customer',
              status: 'active',
              pwd_permit_number: hasPwdPermit ? 'MANUAL' : null,
              pwd_verified: hasPwdPermit,
            })
            .select()
            .single();

          if (customerError) throw customerError;
          customerId = newCustomer.id;
        }
      } else {
        // Use a generic walk-in customer
        const { data: genericCustomer } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', 'walkin@parkwise.local')
          .single();

        customerId = genericCustomer?.id || 'walkin';
      }

      // Create vehicle if not exists
      let vehicleId: string;
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('plate_number', plateNumber.toUpperCase())
        .single();

      if (existingVehicle) {
        vehicleId = existingVehicle.id;
      } else {
        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert({
            owner_id: customerId,
            plate_number: plateNumber.toUpperCase(),
            vehicle_type: vehicleType,
            is_default: true,
          })
          .select()
          .single();

        if (vehicleError) throw vehicleError;
        vehicleId = newVehicle.id;
      }

      // Calculate end time
      const startTime = new Date(timeIn);
      const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

      // Create reservation
      const { data: reservation, error: reservationError } = await supabase
        .from('reservations')
        .insert({
          customer_id: customerId,
          vehicle_id: vehicleId,
          slot_id: selectedSlot,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          status: 'active',
          booking_code: `WALK-${Date.now()}`,
        })
        .select()
        .single();

      if (reservationError) throw reservationError;

      // Update slot status
      await supabase
        .from('slots')
        .update({
          status: 'occupied',
          current_reservation_id: reservation.id,
        })
        .eq('id', selectedSlot);

      // Inform agent service
      await fetch(`${AGENT_SERVICE_URL}/agents/${selectedSlot}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_plate: plateNumber.toUpperCase() }),
      });

      // Log to audit
      const slot = slots.find(s => s.id === selectedSlot);
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'manual_entry',
        details: {
          plate: plateNumber.toUpperCase(),
          vehicle_type: vehicleType,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          slot_code: slot?.slot_code,
          slot_id: selectedSlot,
          time_in: timeIn,
          duration,
          has_pwd_permit: hasPwdPermit,
          reason,
          reservation_id: reservation.id,
          status: 'active',
        },
      });

      setSuccess(true);
      
      // Reset form
      setPlateNumber('');
      setVehicleType('four_wheeled');
      setCustomerName('');
      setCustomerPhone('');
      setSelectedSlot('');
      setTimeIn(new Date().toISOString().slice(0, 16));
      setDuration(1);
      setHasPwdPermit(false);
      setReason('');

      // Reload data
      loadSlots();
      loadRecentEntries();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Error creating manual entry:', error);
      setError('Failed to create manual entry');
    } finally {
      setSaving(false);
    }
  };

  const handleVoidEntry = async (entry: ManualEntry) => {
    if (!confirm('Are you sure you want to void this manual entry?')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Update audit log entry
      await supabase
        .from('audit_log')
        .update({
          details: {
            ...(entry as any).details,
            status: 'voided',
            voided_by: user?.id,
            voided_at: new Date().toISOString(),
          },
        })
        .eq('id', entry.id);

      // If reservation exists, cancel it
      if (entry.slotId) {
        await supabase
          .from('reservations')
          .update({ status: 'cancelled' })
          .eq('slot_id', entry.slotId)
          .eq('status', 'active');

        // Free the slot
        await supabase
          .from('slots')
          .update({
            status: 'available',
            current_reservation_id: null,
          })
          .eq('id', entry.slotId);

        // Reset agent
        await fetch(`${AGENT_SERVICE_URL}/agents/${entry.slotId}/release`, { method: 'POST' });
      }

      loadRecentEntries();
      loadSlots();
    } catch (error) {
      console.error('Error voiding entry:', error);
      alert('Failed to void entry');
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Manual Entry</h1>
              <p className="text-sm text-gray-600">Walk-in Vehicle Registration</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}
            >
              <Bell size={18} />
            </button>
            <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              {profile?.role}
            </span>
            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Manual Entry Form */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Vehicle Information</h2>

            {success && (
              <div className="mb-4 p-4 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
                <CheckCircle size={20} />
                <span className="font-semibold">Manual entry created successfully</span>
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
                <AlertTriangle size={20} />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Plate Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Plate Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  placeholder="ABC123 or ABC123XY"
                  className="input uppercase"
                  disabled={saving}
                />
                <p className="text-xs text-gray-500 mt-1">Format: 3 letters + 3 numbers (e.g., ABC123)</p>
              </div>

              {/* Vehicle Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vehicle Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="input"
                  disabled={saving}
                >
                  <option value="four_wheeled">Four-Wheeled</option>
                  <option value="motorcycle" disabled>Motorcycle (Not Allowed)</option>
                </select>
                <p className="text-xs text-red-500 mt-1">Only four-wheeled vehicles are allowed</p>
              </div>

              {/* Customer Name (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Name <span className="text-gray-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  className="input"
                  disabled={saving}
                />
              </div>

              {/* Customer Phone (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Phone <span className="text-gray-400">(Optional)</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  className="input"
                  disabled={saving}
                />
              </div>

              {/* Slot Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slot <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value)}
                  className="input"
                  disabled={saving}
                >
                  <option value="">Select a slot</option>
                  {slots.map(slot => (
                    <option key={slot.id} value={slot.id}>
                      {slot.slot_code} {slot.is_pwd ? '(PWD)' : ''}
                    </option>
                  ))}
                </select>
                {slots.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">No available slots</p>
                )}
              </div>

              {/* Time In */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Time In <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={timeIn}
                  onChange={(e) => setTimeIn(e.target.value)}
                  className="input"
                  disabled={saving}
                />
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Duration (hours) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                  className="input"
                  disabled={saving}
                />
              </div>

              {/* PWD Permit */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pwdPermit"
                  checked={hasPwdPermit}
                  onChange={(e) => setHasPwdPermit(e.target.checked)}
                  disabled={saving}
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                />
                <label htmlFor="pwdPermit" className="text-sm text-gray-700">
                  PWD Permit (Only for PWD slots)
                </label>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why manual entry is needed..."
                  className="input w-full h-24"
                  disabled={saving}
                />
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Creating Entry...
                  </>
                ) : (
                  <>
                    <FileText size={18} />
                    Create Manual Entry
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Recent Manual Entries */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Manual Entries</h2>
            
            {recentEntries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText size={48} className="mx-auto mb-4 opacity-50" />
                <p>No recent manual entries</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {recentEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-4 border rounded-lg ${
                      entry.status === 'voided' ? 'bg-gray-50 border-gray-200 opacity-60' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{entry.plate}</p>
                        <p className="text-sm text-gray-600">{entry.slot}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        entry.status === 'voided' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {entry.status}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600 space-y-1">
                      <div className="flex items-center gap-2">
                        <Car size={14} />
                        <span>{entry.vehicleType}</span>
                      </div>
                      {entry.customerName && (
                        <div className="flex items-center gap-2">
                          <User size={14} />
                          <span>{entry.customerName}</span>
                        </div>
                      )}
                      {entry.customerPhone && (
                        <div className="flex items-center gap-2">
                          <Phone size={14} />
                          <span>{entry.customerPhone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Clock size={14} />
                        <span>{new Date(entry.timeIn).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={14} />
                        <span>{entry.duration} hours</span>
                      </div>
                      {entry.hasPwdPermit && (
                        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                          PWD Permit
                        </span>
                      )}
                    </div>

                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 italic">Reason: {entry.reason}</p>
                    </div>

                    {isAdmin && entry.status === 'active' && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleVoidEntry(entry)}
                          className="btn-secondary px-3 py-1 text-sm flex items-center gap-1 text-red-600"
                        >
                          <Trash2 size={14} />
                          Void
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-amber-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Confirm Logout</h3>
              <p className="text-gray-600">
                Are you sure you want to log out?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <LogOut size={18} />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
