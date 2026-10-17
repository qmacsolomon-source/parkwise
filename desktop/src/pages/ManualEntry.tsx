import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/DialogContext';
import { supabase } from '@parkwise/shared';
import { Slot, ReservationStatus } from '@parkwise/shared';
import {
  FileText, AlertTriangle, CheckCircle, LogOut, Volume2, VolumeX,
  Trash2, Clock, User, Phone, MapPin
} from 'lucide-react';

const AGENT_SERVICE_URL = 'http://localhost:8000';

interface ManualEntry {
  id: string;
  plate: string;
  customerName: string | null;
  customerPhone: string | null;
  slot: string;
  slotId: string;
  timeIn: string;
  durationMinutes: number;
  hasPwdPermit: boolean;
  attendant: string;
  createdAt: string;
  // 'voided' is a staff action recorded in audit_log and always wins.
  // Anything else reflects the reservation's REAL current status (fetched
  // fresh in loadRecentEntries), not just whatever was true the moment
  // this entry was created -- otherwise a paid, completed entry would go
  // on showing "active" forever, which is exactly backwards from what the
  // attendant needs to see.
  status: ReservationStatus | 'voided';
  details: Record<string, any>;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

// Void ends a session with no payment collected -- only makes sense while
// the reservation is still genuinely ongoing. Letting it show on an
// already-completed, cancelled, or no-show entry would suggest an action
// that doesn't make sense to take on something already resolved.
function isVoidableStatus(status: ReservationStatus | 'voided'): boolean {
  return status === 'active' || status === 'verified' || status === 'overstay';
}

function getEntryStatusBadgeClass(status: ReservationStatus | 'voided'): string {
  switch (status) {
    case 'voided':
    case 'cancelled':
    case 'no_show':
      return 'bg-gray-100 text-gray-600';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'overstay':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-blue-100 text-blue-800';
  }
}

export default function ManualEntry() {
  const { profile, logout } = useAuth();
  const dialog = useDialog();
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
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [hasPwdPermit, setHasPwdPermit] = useState(false);

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

      // audit_log.details.status is only ever written at creation time
      // ('active') or by handleVoidEntry ('voided') -- it has no idea a
      // reservation was later paid off, cancelled, or went into overstay.
      // Look up each entry's actual reservation status fresh so the badge
      // (and the Void button's availability) reflect what's really true
      // right now, not a snapshot from whenever this entry was created.
      const reservationIds = (data || [])
        .map((item: any) => item.details.reservation_id)
        .filter(Boolean);

      const liveStatusByReservationId: Record<string, ReservationStatus> = {};
      if (reservationIds.length > 0) {
        const { data: liveReservations } = await supabase
          .from('reservations')
          .select('id, status')
          .in('id', reservationIds);
        (liveReservations || []).forEach((r: any) => {
          liveStatusByReservationId[r.id] = r.status;
        });
      }

      const entries: ManualEntry[] = (data || []).map((item: any) => {
        const wasVoided = item.details.status === 'voided';
        const liveStatus = liveStatusByReservationId[item.details.reservation_id];
        return {
          id: item.id,
          plate: item.details.plate,
          customerName: item.details.customer_name || null,
          customerPhone: item.details.customer_phone || null,
          slot: item.details.slot_code,
          slotId: item.details.slot_id,
          timeIn: item.details.time_in,
          durationMinutes: item.details.duration_minutes ?? Math.round((item.details.duration || 0) * 60),
          hasPwdPermit: item.details.has_pwd_permit,
          attendant: item.actor_id,
          createdAt: item.created_at,
          status: wasVoided ? 'voided' : (liveStatus || 'active'),
          details: item.details,
        };
      });

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

    if (!customerName.trim()) {
      setError('Customer name is required');
      return false;
    }

    if (customerPhone.replace(/\D/g, '').length !== 11) {
      setError('Mobile number must be 11 digits');
      return false;
    }

    if (!selectedSlot) {
      setError('Please select a slot');
      return false;
    }

    if (durationHours * 60 + durationMinutes <= 0) {
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

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Find or create the walk-in customer's profile
      let customerId: string;
      const { data: existingCustomer } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone', customerPhone)
        .single();

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
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
            vehicle_type: 'four_wheeled',
            is_default: true,
          })
          .select()
          .single();

        if (vehicleError) throw vehicleError;
        vehicleId = newVehicle.id;
      }

      // Calculate end time
      const totalDurationMinutes = durationHours * 60 + durationMinutes;
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);

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

      // Inform agent service (best-effort: the reservation itself already
      // succeeded above, so a missing/offline agent-service shouldn't make
      // the whole manual entry report as failed)
      try {
        await fetch(`${AGENT_SERVICE_URL}/agents/${selectedSlot}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_plate: plateNumber.toUpperCase() }),
        });
      } catch (agentError) {
        console.warn('Agent service unreachable:', agentError);
      }

      // Log to audit
      const slot = slots.find(s => s.id === selectedSlot);
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'manual_entry',
        details: {
          plate: plateNumber.toUpperCase(),
          vehicle_type: 'four_wheeled',
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          slot_code: slot?.slot_code,
          slot_id: selectedSlot,
          time_in: startTime.toISOString(),
          duration_minutes: totalDurationMinutes,
          has_pwd_permit: hasPwdPermit,
          reservation_id: reservation.id,
          status: 'active',
        },
      });

      setSuccess(true);

      // Reset form
      setPlateNumber('');
      setCustomerName('');
      setCustomerPhone('');
      setSelectedSlot('');
      setDurationHours(1);
      setDurationMinutes(0);
      setHasPwdPermit(false);

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
    // Void exists to undo an immediate mistake (wrong plate typed, wrong
    // slot picked), not to end an active parking session -- doing that
    // releases the slot with no payment collected and no record of the
    // time used, which is never the intended flow (use Cash Payment for
    // that). It can't be outright blocked -- genuine mistakes do happen,
    // even minutes later -- so once the entry has been sitting long enough
    // that a car is almost certainly actually parked there, make it much
    // harder to do by accident instead of a generic "are you sure?".
    const minutesSinceEntry = (Date.now() - new Date(entry.timeIn).getTime()) / 60000;
    const VOID_GRACE_PERIOD_MINUTES = 5;

    if (minutesSinceEntry > VOID_GRACE_PERIOD_MINUTES) {
      const confirmed = await dialog.confirm(
        `This vehicle checked in ${Math.round(minutesSinceEntry)} minutes ago and is very likely still parked in ${entry.slot} right now. Voiding it will immediately free the slot with NO PAYMENT collected and no record this ever happened -- this is not how a normal parking session should end; use Cash Payment for that instead.\n\nOnly continue if this entry genuinely needs to be erased.`,
        'This Looks Like An Active Session, Not A Mistake',
        { confirmLabel: 'Void Anyway', danger: true }
      );
      if (!confirmed) return;
    } else {
      if (!(await dialog.confirm('Are you sure you want to void this manual entry?'))) return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Update audit log entry
      await supabase
        .from('audit_log')
        .update({
          details: {
            ...entry.details,
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

        // Reset agent (best-effort, same reasoning as above)
        try {
          await fetch(`${AGENT_SERVICE_URL}/agents/${entry.slotId}/release`, { method: 'POST' });
        } catch (agentError) {
          console.warn('Agent service unreachable:', agentError);
        }
      }

      loadRecentEntries();
      loadSlots();
    } catch (error) {
      console.error('Error voiding entry:', error);
      await dialog.alert('Failed to void entry');
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
              title={soundEnabled ? 'Sound alerts on' : 'Sound alerts off'}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
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

              {/* Customer Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Name <span className="text-red-500">*</span>
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

              {/* Customer Phone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  className="input"
                  disabled={saving}
                />
                <p className="text-xs text-gray-500 mt-1">11 digits, e.g. 09171234567</p>
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

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Duration <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="number"
                      min="0"
                      max="24"
                      value={durationHours}
                      onChange={(e) => setDurationHours(parseInt(e.target.value) || 0)}
                      className="input"
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">Hours</p>
                  </div>
                  <div className="flex-1">
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                      className="input"
                      disabled={saving}
                    />
                    <p className="text-xs text-gray-500 mt-1">Minutes</p>
                  </div>
                </div>
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
                      entry.status === 'voided' || entry.status === 'cancelled' || entry.status === 'no_show'
                        ? 'bg-gray-50 border-gray-200 opacity-60'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{entry.plate}</p>
                        <p className="text-sm text-gray-600">{entry.slot}</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getEntryStatusBadgeClass(entry.status)}`}>
                        {entry.status}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600 space-y-1">
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
                        <span>{formatDuration(entry.durationMinutes)}</span>
                      </div>
                      {entry.hasPwdPermit && (
                        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                          PWD Permit
                        </span>
                      )}
                    </div>

                    {isAdmin && isVoidableStatus(entry.status) && (
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
