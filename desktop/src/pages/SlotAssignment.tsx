import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { AgentState, Slot, Reservation, groupSlotsByFloor } from '@parkwise/shared';
import ParkingFloorMap from '../components/ParkingFloorMap';
import FloorSwitcher from '../components/FloorSwitcher';
import {
  MapPin, AlertTriangle, CheckCircle, LogOut, Volume2, VolumeX,
  RefreshCw, Clock, User, Car
} from 'lucide-react';

const AGENT_SERVICE_URL = 'http://localhost:8000';

interface ReservationWithDetails extends Reservation {
  slot_code: string;
  customer_name: string;
  vehicle_plate: string;
  is_pwd: boolean;
}

/**
 * Reflects the slot's agent_states.state on the reservation card. Without
 * this, Accept Vehicle never visibly changed anything - it doesn't touch
 * reservations.status, so the card looked identical before and after a
 * successful click, and nothing stopped (or explained) clicking it again.
 */
function cameraStatusMeta(state?: AgentState['state']): {
  label: string;
  className: string;
  buttonLabel: string;
  lockButton: boolean;
} | null {
  switch (state) {
    case 'waiting':
    case 'verifying':
      return {
        label: 'Camera watching',
        className: 'bg-amber-100 text-amber-800',
        buttonLabel: 'Camera watching...',
        lockButton: true,
      };
    case 'verified':
      return {
        label: 'Verified',
        className: 'bg-green-100 text-green-800',
        buttonLabel: 'Verified',
        lockButton: true,
      };
    case 'alert':
      return {
        label: 'Needs review',
        className: 'bg-red-100 text-red-800',
        buttonLabel: 'Re-accept (retry)',
        lockButton: false,
      };
    case 'idle':
    default:
      return null;
  }
}

export default function SlotAssignment() {
  const { profile, logout } = useAuth();
  const location = useLocation();
  const pendingReservationId = useRef<string | null>(
    (location.state as { reservationId?: string } | null)?.reservationId ?? null
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<ReservationWithDetails[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [loading, setLoading] = useState(true);
  const [reassigning, setReassigning] = useState(false);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<ReservationWithDetails | null>(null);
  const [newSlotId, setNewSlotId] = useState('');
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [showSlotSettings, setShowSlotSettings] = useState(false);
  const [floor, setFloor] = useState(1);

  const handleFloorChange = (newFloor: number) => {
    setFloor(newFloor);
  };

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadData();
    const slotsSubscription = supabase
      .channel('slots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => {
        loadSlots();
      })
      .subscribe();

    const reservationsSubscription = supabase
      .channel('reservations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        loadReservations();
      })
      .subscribe();

    // So "Accept Vehicle" actually shows something once clicked - without
    // this, the card has no way to reflect that the slot's agent is now
    // armed and watching, since Accept Vehicle never changes the
    // reservation's own status (that only happens on release/verification).
    const agentStatesSubscription = supabase
      .channel('slot-assignment-agent-states-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_states' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setAgentStates((prev) => ({
            ...prev,
            [(payload.new as AgentState).slot_id]: payload.new as AgentState,
          }));
        }
      })
      .subscribe();

    return () => {
      slotsSubscription.unsubscribe();
      reservationsSubscription.unsubscribe();
      agentStatesSubscription.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    await Promise.all([loadSlots(), loadReservations(), loadAgentStates()]);
  };

  const loadAgentStates = async () => {
    try {
      const { data } = await supabase.from('agent_states').select('*');
      const next: Record<string, AgentState> = {};
      (data || []).forEach((state: AgentState) => {
        next[state.slot_id] = state;
      });
      setAgentStates(next);
    } catch (error) {
      console.error('Error loading agent states:', error);
    }
  };

  const loadSlots = async () => {
    try {
      const { data } = await supabase
        .from('slots')
        .select('*')
        .order('slot_code');
      setSlots(data || []);
    } catch (error) {
      console.error('Error loading slots:', error);
    }
  };

  const loadReservations = async () => {
    setLoading(true);
    try {
      const now = new Date();
      // slots!reservations_slot_id_fkey, not slots!inner: slots also has
      // current_reservation_id pointing back at reservations.id, so a bare
      // "slots!inner" is ambiguous between the two FKs (PGRST201) and
      // PostgREST rejects the whole query - which the old code never
      // surfaced (it only ever read `data`, never `error`), so this silently
      // rendered an empty list instead of failing loudly.
      const { data, error: loadError } = await supabase
        .from('reservations')
        .select(`
          *,
          slots!reservations_slot_id_fkey(slot_code, is_pwd, status),
          profiles!inner(full_name),
          vehicles!inner(plate_number)
        `)
        .in('status', ['pending', 'active'])
        .gte('start_time', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .order('start_time');

      if (loadError) {
        console.error('Error loading reservations:', loadError);
        setError(loadError.message || 'Failed to load reservations');
      }

      const reservationsWithDetails: ReservationWithDetails[] = (data || []).map((r: any) => ({
        ...r,
        slot_code: r.slots.slot_code,
        customer_name: r.profiles.full_name,
        vehicle_plate: r.vehicles.plate_number,
        is_pwd: r.slots.is_pwd,
      }));

      setReservations(reservationsWithDetails);

      // Came here from Live Occupancy's "Reassign Slot" for a specific
      // reservation -- open straight into that reassign flow instead of
      // making the attendant re-find it in this page's list. Only consume
      // once, so the realtime subscription's later refreshes don't keep
      // re-opening the modal.
      if (pendingReservationId.current) {
        const target = reservationsWithDetails.find(r => r.id === pendingReservationId.current);
        pendingReservationId.current = null;
        if (target) {
          setSelectedReservation(target);
          setShowReassignModal(true);
        }
      }
    } catch (error) {
      console.error('Error loading reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkTimeOverlap = async (slotId: string, startTime: string, endTime: string, excludeReservationId?: string): Promise<boolean> => {
    const { data } = await supabase
      .from('reservations')
      .select('id')
      .eq('slot_id', slotId)
      .in('status', ['pending', 'active'])
      .neq('id', excludeReservationId || '')
      .or(`and(start_time.lte.${endTime},end_time.gte.${startTime})`);

    return (data || []).length > 0;
  };

  const handleReassign = async () => {
    if (!selectedReservation || !newSlotId) return;

    setReassigning(true);
    setError('');

    try {
      const slot = slots.find(s => s.id === newSlotId);
      if (!slot) {
        setError('Invalid slot selected');
        setReassigning(false);
        return;
      }

      // Check PWD eligibility
      if (slot.is_pwd && !selectedReservation.is_pwd) {
        setError('Cannot assign non-PWD reservation to PWD slot');
        setReassigning(false);
        return;
      }

      // Check time overlap
      const hasOverlap = await checkTimeOverlap(
        newSlotId,
        selectedReservation.start_time,
        selectedReservation.end_time,
        selectedReservation.id
      );

      if (hasOverlap) {
        setError('Selected slot has overlapping reservation');
        setReassigning(false);
        return;
      }

      // Get old slot for logging
      const oldSlot = slots.find(s => s.id === selectedReservation.slot_id);

      // Update reservation
      await supabase
        .from('reservations')
        .update({ slot_id: newSlotId })
        .eq('id', selectedReservation.id);

      // Update old slot status if it was occupied
      if (oldSlot?.status === 'occupied') {
        await supabase
          .from('slots')
          .update({ status: 'available', current_reservation_id: null })
          .eq('id', oldSlot.id);
      }

      // Update new slot status
      await supabase
        .from('slots')
        .update({ status: 'occupied', current_reservation_id: selectedReservation.id })
        .eq('id', newSlotId);

      // Log to audit_log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'slot_reassigned',
        details: {
          reservation_id: selectedReservation.id,
          old_slot_id: selectedReservation.slot_id,
          new_slot_id: newSlotId,
          old_slot_code: oldSlot?.slot_code,
          new_slot_code: slot.slot_code,
          customer_name: selectedReservation.customer_name,
          vehicle_plate: selectedReservation.vehicle_plate,
        },
      });

      // Notify customer via notification
      await supabase.from('notifications').insert({
        user_id: selectedReservation.customer_id,
        title: 'Slot Reassigned',
        body: `Your reservation has been moved to slot ${slot.slot_code}`,
        type: 'system',
      });

      // Update agent's expected slot if reservation is active
      if (selectedReservation.status === 'active') {
        try {
          await fetch(`${AGENT_SERVICE_URL}/beam`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slot_id: newSlotId,
              expected_plate: selectedReservation.vehicle_plate,
            }),
          });
        } catch (err) {
          console.error('Failed to update agent:', err);
        }
      }

      setSuccess(true);
      setShowReassignModal(false);
      setSelectedReservation(null);
      setNewSlotId('');
      await loadData();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error reassigning slot:', error);
      setError(error.message || 'Failed to reassign slot');
    } finally {
      setReassigning(false);
    }
  };

  // Arms the camera-matching agent for this reservation's slot - the same
  // call Plate Verification's "Accept Vehicle" makes, just reachable from
  // the list the attendant is already looking at instead of making them
  // re-pick the same slot and reservation from a pair of dropdowns on a
  // different page.
  const handleCheckIn = async (reservation: ReservationWithDetails) => {
    setCheckingInId(reservation.id);
    setError('');

    try {
      const response = await fetch(`${AGENT_SERVICE_URL}/agents/${reservation.slot_id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_plate: reservation.vehicle_plate }),
      });

      if (!response.ok) throw new Error('Failed to check in vehicle');

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error checking in vehicle:', err);
      setError(err.message || 'Failed to check in vehicle. Is agent-service running?');
    } finally {
      setCheckingInId(null);
    }
  };

  const handleSlotSettings = async () => {
    if (!editingSlot) return;

    try {
      await supabase
        .from('slots')
        .update({
          is_pwd: editingSlot.is_pwd,
          status: editingSlot.status,
        })
        .eq('id', editingSlot.id);

      setSuccess(true);
      setShowSlotSettings(false);
      setEditingSlot(null);
      await loadSlots();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error updating slot:', error);
      setError(error.message || 'Failed to update slot');
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const availableSlots = slots.filter(s => s.status === 'available');
  const totalFloors = slots.reduce((max, s) => Math.max(max, s.floor), 1);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Slot Assignment</h1>
              <p className="text-sm text-gray-600">Manage Reservations & Slots</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}
              title={soundEnabled ? "Sound alerts on" : "Sound alerts off"}
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
        {success && (
          <div className="mb-4 p-4 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={20} />
            <span className="font-semibold">Operation successful!</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
            <AlertTriangle size={20} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="card mb-6">
          <div className="flex items-center justify-end">
            <button
              onClick={loadData}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        {/* Slot Map */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Slot Map</h2>
            <FloorSwitcher floor={floor} totalFloors={totalFloors} onChange={handleFloorChange} />
          </div>
          <div>
            <ParkingFloorMap
              slots={slots}
              floor={floor}
              selectedSlotId={editingSlot?.id}
              onSlotClick={(slot) => {
                if (isAdmin) {
                  setEditingSlot(slot);
                  setShowSlotSettings(true);
                }
              }}
              getSlotTitle={(slot) => `${slot.slot_code} - ${slot.status}${slot.is_pwd ? ' (PWD)' : ''}`}
            />
          </div>
        </div>

        {/* Reservations List */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming & Active Reservations</h2>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : reservations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No reservations found</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto">
              {reservations.map((reservation) => {
                const agentState = agentStates[reservation.slot_id];
                const camera = cameraStatusMeta(agentState?.state);

                return (
                <div
                  key={reservation.id}
                  className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-900">
                          Slot {reservation.slot_code}
                        </span>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          reservation.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {reservation.status}
                        </span>
                        {reservation.is_pwd && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800">
                            PWD
                          </span>
                        )}
                        {camera && (
                          <span className={`px-2 py-0.5 text-xs rounded-full ${camera.className}`}>
                            {camera.label}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <User size={14} />
                          <span>{reservation.customer_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Car size={14} />
                          <span>{reservation.vehicle_plate}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock size={14} />
                          <span>
                            {new Date(reservation.start_time).toLocaleString()} - {new Date(reservation.end_time).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCheckIn(reservation)}
                    disabled={checkingInId === reservation.id || camera?.lockButton}
                    className="mt-3 w-full px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle size={14} />
                    {checkingInId === reservation.id
                      ? 'Checking in...'
                      : camera?.buttonLabel ?? 'Accept Vehicle (start camera watch)'}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedReservation(reservation);
                      setShowReassignModal(true);
                    }}
                    className="mt-2 w-full px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary-dark"
                  >
                    Reassign
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Reassign Modal */}
      {showReassignModal && selectedReservation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Reassign Slot</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  <strong>Current:</strong> Slot {selectedReservation.slot_code}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Customer:</strong> {selectedReservation.customer_name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Vehicle:</strong> {selectedReservation.vehicle_plate}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select New Slot <span className="text-red-500">*</span>
                </label>
                <select
                  value={newSlotId}
                  onChange={(e) => setNewSlotId(e.target.value)}
                  className="input"
                  disabled={reassigning}
                >
                  <option value="">-- Select a slot --</option>
                  {groupSlotsByFloor(availableSlots).map(group => (
                    <optgroup key={group.floor} label={`Floor ${group.floor}`}>
                      {group.slots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.slot_code} {slot.is_pwd ? '(PWD)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowReassignModal(false);
                  setSelectedReservation(null);
                  setNewSlotId('');
                  setError('');
                }}
                className="btn-secondary flex-1"
                disabled={reassigning}
              >
                Cancel
              </button>
              <button
                onClick={handleReassign}
                className="btn-primary flex-1"
                disabled={reassigning || !newSlotId}
              >
                {reassigning ? 'Reassigning...' : 'Reassign'}
              </button>
            </div>
            {!newSlotId && (
              <p className="text-xs text-amber-600 mt-2">
                Choose a new slot above before reassigning.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Slot Settings Modal (Admin Only) */}
      {showSlotSettings && editingSlot && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Manage Slot {editingSlot.slot_code}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={editingSlot.status}
                  onChange={(e) => setEditingSlot({ ...editingSlot, status: e.target.value as any })}
                  className="input"
                >
                  <option value="available">Available</option>
                  <option value="occupied">Occupied</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSlotSettings(false);
                  setEditingSlot(null);
                }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSlotSettings}
                className="btn-primary flex-1"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

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
