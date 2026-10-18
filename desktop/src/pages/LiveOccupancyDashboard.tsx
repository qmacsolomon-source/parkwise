import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/DialogContext';
import { supabase } from '@parkwise/shared';
import { Slot, AgentState, Reservation, Profile, Vehicle } from '@parkwise/shared';
import {
  LayoutDashboard, LogOut, RefreshCw, Search,
  AlertTriangle, Car, Clock, User, X, Volume2, VolumeX,
  CheckCircle, ParkingCircle,
  Accessibility, ChevronRight, Camera, FileText,
} from 'lucide-react';
import ParkingFloorMap from '../components/ParkingFloorMap';
import FloorSwitcher from '../components/FloorSwitcher';

interface SummaryStats {
  total: number;
  occupied: number;
  reserved: number;
  available: number;
  alerts: number;
}

export default function LiveOccupancyDashboard() {
  const { profile, logout } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [reservations, setReservations] = useState<Record<string, Reservation>>({});
  const [customers, setCustomers] = useState<Record<string, Profile>>({});
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPwdOnly, setFilterPwdOnly] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alertedSlots, setAlertedSlots] = useState<Set<string>>(new Set());
  const [floor, setFloor] = useState(1);

  const handleFloorChange = (newFloor: number) => {
    setFloor(newFloor);
  };

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Calculate summary stats
  const stats: SummaryStats = React.useMemo(() => {
    const total = slots.length;
    const occupied = slots.filter(s => s.status === 'occupied').length;
    const reserved = slots.filter(s => s.status === 'reserved').length;
    const available = slots.filter(s => s.status === 'available').length;
    const alerts = slots.filter(s => s.status === 'overstay' || s.status === 'unverified').length;
    return { total, occupied, reserved, available, alerts };
  }, [slots]);

  // Filter slots
  const filteredSlots = React.useMemo(() => {
    return slots
      .filter(slot => {
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesCode = slot.slot_code.toLowerCase().includes(query);
          const slotReservation = slot.current_reservation_id ? reservations[slot.current_reservation_id] : undefined;
          const slotVehicle = slotReservation ? vehicles[slotReservation.vehicle_id] : undefined;
          const slotCustomer = slotVehicle ? customers[slotVehicle.owner_id] : undefined;
          const matchesPlate = slotVehicle ? slotVehicle.plate_number.toLowerCase().includes(query) : false;
          const matchesCustomer = slotCustomer ? slotCustomer.full_name.toLowerCase().includes(query) : false;
          if (!matchesCode && !matchesPlate && !matchesCustomer) return false;
        }

        // Status filter
        if (filterStatus !== 'all' && slot.status !== filterStatus) return false;

        // PWD filter
        if (filterPwdOnly && !slot.is_pwd) return false;

        return true;
      })
      .sort((a, b) => {
        // Sort numerically: extract letter and number
        const matchA = a.slot_code.match(/([A-Za-z]+)(\d+)/);
        const matchB = b.slot_code.match(/([A-Za-z]+)(\d+)/);

        if (matchA && matchB) {
          const [, letterA, numA] = matchA;
          const [, letterB, numB] = matchB;

          if (letterA !== letterB) {
            return letterA.localeCompare(letterB);
          }
          return parseInt(numA, 10) - parseInt(numB, 10);
        }

        return a.slot_code.localeCompare(b.slot_code);
      });
  }, [slots, searchQuery, filterStatus, filterPwdOnly, vehicles, customers, reservations]);

  const totalFloors = React.useMemo(
    () => slots.reduce((max, s) => Math.max(max, s.floor), 1),
    [slots]
  );

  // If a search only matches something on a different floor than the one
  // showing, jump there automatically instead of leaving the attendant
  // looking at an empty map wondering where their result went.
  useEffect(() => {
    if (!searchQuery) return;
    const hasMatchOnCurrentFloor = filteredSlots.some(s => s.floor === floor);
    if (hasMatchOnCurrentFloor) return;
    const firstMatch = filteredSlots[0];
    if (firstMatch) handleFloorChange(firstMatch.floor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, filteredSlots]);

  // Load data
  useEffect(() => {
    loadData();

    // Real-time subscriptions
    const slotsSubscription = supabase
      .channel('slots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSlots(prev => [...prev, payload.new as Slot]);
        } else if (payload.eventType === 'UPDATE') {
          setSlots(prev => prev.map(s => s.id === payload.new.id ? payload.new as Slot : s));
          
          // Check for alert states
          const newSlot = payload.new as Slot;
          if (newSlot.status === 'overstay' || newSlot.status === 'unverified') {
            if (!alertedSlots.has(newSlot.id)) {
              setAlertedSlots(prev => new Set([...prev, newSlot.id]));
              if (soundEnabled) {
                playAlertSound();
              }
            }
          }
        } else if (payload.eventType === 'DELETE') {
          setSlots(prev => prev.filter(s => s.id !== payload.old.id));
        }
      })
      .subscribe();

    const agentStatesSubscription = supabase
      .channel('agent-states-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_states' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setAgentStates(prev => ({
            ...prev,
            [payload.new.slot_id]: payload.new as AgentState,
          }));
        }
      })
      .subscribe();

    const reservationsSubscription = supabase
      .channel('reservations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setReservations(prev => ({
            ...prev,
            [payload.new.id]: payload.new as Reservation,
          }));
        } else if (payload.eventType === 'DELETE') {
          setReservations(prev => {
            const newState = { ...prev };
            delete newState[payload.old.id];
            return newState;
          });
        }
      })
      .subscribe();

    return () => {
      slotsSubscription.unsubscribe();
      agentStatesSubscription.unsubscribe();
      reservationsSubscription.unsubscribe();
    };
  }, [alertedSlots, soundEnabled]);

  const loadData = async () => {
    try {
      const [slotsData, agentStatesData, reservationsData, customersData, vehiclesData] = await Promise.all([
        supabase.from('slots').select('*').order('slot_code'),
        supabase.from('agent_states').select('*'),
        supabase.from('reservations').select('*').in('status', ['active', 'verified', 'overstay']),
        supabase.from('profiles').select('*'),
        supabase.from('vehicles').select('*'),
      ]);

      if (slotsData.data) setSlots(slotsData.data);
      
      if (agentStatesData.data) {
        const statesMap: Record<string, AgentState> = {};
        agentStatesData.data.forEach(state => {
          statesMap[state.slot_id] = state;
        });
        setAgentStates(statesMap);
      }

      if (reservationsData.data) {
        const reservationsMap: Record<string, Reservation> = {};
        reservationsData.data.forEach(res => {
          reservationsMap[res.id] = res;
        });
        setReservations(reservationsMap);
      }

      if (customersData.data) {
        const customersMap: Record<string, Profile> = {};
        customersData.data.forEach(customer => {
          customersMap[customer.id] = customer;
        });
        setCustomers(customersMap);
      }

      if (vehiclesData.data) {
        const vehiclesMap: Record<string, Vehicle> = {};
        vehiclesData.data.forEach(vehicle => {
          vehiclesMap[vehicle.id] = vehicle;
        });
        setVehicles(vehiclesMap);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const playAlertSound = () => {
    const audio = new Audio('/alert.mp3');
    audio.play().catch(e => console.log('Audio play failed:', e));
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const handleSlotClick = (slot: Slot) => {
    setSelectedSlot(slot);
    setShowDrawer(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="animate-spin mx-auto text-primary" size={32} />
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
            <LayoutDashboard className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Live Occupancy Dashboard</h1>
              <p className="text-sm text-gray-600">Welcome, {profile?.full_name}</p>
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
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <SummaryCard label="Total" value={stats.total} icon={ParkingCircle} color="primary" />
          <SummaryCard label="Occupied" value={stats.occupied} icon={Car} color="blue" />
          <SummaryCard label="Reserved" value={stats.reserved} icon={Clock} color="amber" />
          <SummaryCard label="Available" value={stats.available} icon={CheckCircle} color="green" />
          <SummaryCard label="Alerts" value={stats.alerts} icon={AlertTriangle} color="red" alert={stats.alerts > 0} />
        </div>

        {/* Search and Filters */}
        <div className="card mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search by slot, plate, or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="reserved">Reserved</option>
                <option value="overstay">Overstay</option>
                <option value="unverified">Unverified</option>
              </select>
              <button
                onClick={() => setFilterPwdOnly(!filterPwdOnly)}
                className={`input flex items-center gap-2 ${filterPwdOnly ? 'bg-accent text-white' : ''}`}
              >
                <Accessibility size={18} />
                PWD Only
              </button>
              <button
                onClick={loadData}
                className="btn-primary"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Floor switcher */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Parking Map</h2>
          <FloorSwitcher floor={floor} totalFloors={totalFloors} onChange={handleFloorChange} />
        </div>

        <div>
          <ParkingFloorMap
            slots={filteredSlots}
            floor={floor}
            onSlotClick={handleSlotClick}
            selectedSlotId={selectedSlot?.id}
            getSlotTitle={(slot) => {
              const reservation = slot.current_reservation_id ? reservations[slot.current_reservation_id] : null;
              const vehicle = reservation ? vehicles[reservation.vehicle_id] : null;
              const customer = vehicle ? customers[vehicle.owner_id] : null;
              if (!vehicle) return `${slot.slot_code} - ${slot.status}`;
              return `${slot.slot_code} - ${vehicle.plate_number}${customer ? ` - ${customer.full_name}` : ''}`;
            }}
          />
        </div>

        {filteredSlots.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <ParkingCircle size={48} className="mx-auto mb-4 opacity-50" />
            <p>No slots match your filters</p>
          </div>
        )}
      </div>

      {/* Slot Detail Drawer */}
      {showDrawer && selectedSlot && (
        <SlotDrawer
          slot={selectedSlot}
          agentState={agentStates[selectedSlot.id]}
          reservation={selectedSlot.current_reservation_id ? reservations[selectedSlot.current_reservation_id] : undefined}
          vehicle={selectedSlot.current_reservation_id ? vehicles[reservations[selectedSlot.current_reservation_id]?.vehicle_id] : undefined}
          customer={selectedSlot.current_reservation_id ? customers[vehicles[reservations[selectedSlot.current_reservation_id]?.vehicle_id]?.owner_id] : undefined}
          onClose={() => {
            setShowDrawer(false);
            setSelectedSlot(null);
          }}
          onRefresh={loadData}
        />
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
                Are you sure you want to log out? You will need to sign in again to access the console.
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

// Summary Card Component
function SummaryCard({ label, value, icon: Icon, color, alert }: { 
  label: string; 
  value: number; 
  icon: any; 
  color: string;
  alert?: boolean;
}) {
  const colorClasses = {
    primary: 'bg-primary text-white',
    blue: 'bg-blue-600 text-white',
    green: 'bg-green-600 text-white',
    amber: 'bg-amber-600 text-white',
    red: 'bg-red-600 text-white',
  };

  return (
    <div className={`card ${colorClasses[color as keyof typeof colorClasses]} ${alert ? 'animate-pulse' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm opacity-90">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <Icon size={32} opacity={0.8} />
      </div>
    </div>
  );
}

// Slot Drawer Component
function SlotDrawer({ 
  slot, 
  agentState, 
  reservation, 
  vehicle, 
  customer, 
  onClose, 
  onRefresh 
}: { 
  slot: Slot; 
  agentState?: AgentState; 
  reservation?: Reservation; 
  vehicle?: Vehicle; 
  customer?: Profile; 
  onClose: () => void; 
  onRefresh: () => void;
}) {
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [loading, setLoading] = useState(false);
  const dialog = useDialog();
  const navigate = useNavigate();

  const handleResolveAlert = async () => {
    if (!resolveNote.trim()) {
      await dialog.alert('Please enter a note');
      return;
    }

    setLoading(true);
    try {
      await supabase.from('audit_log').insert({
        actor_id: (await supabase.auth.getUser()).data.user?.id,
        action: 'resolve_alert',
        details: {
          slot_id: slot.id,
          slot_code: slot.slot_code,
          note: resolveNote,
          previous_status: slot.status,
        },
      });

      // Update slot status
      const newStatus = slot.status === 'overstay' ? 'occupied' : 'occupied';
      await supabase.from('slots').update({ status: newStatus }).eq('id', slot.id);

      setShowResolveModal(false);
      setResolveNote('');
      onRefresh();
      onClose();
    } catch (error) {
      console.error('Failed to resolve alert:', error);
      await dialog.alert('Failed to resolve alert');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className="bg-white h-full w-full max-w-md shadow-xl overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-primary">{slot.slot_code} Details</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={24} />
            </button>
          </div>

          {/* Slot Info */}
          <div className="space-y-4 mb-6">
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-3">Slot Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <span className={`font-medium ${
                    slot.status === 'overstay' || slot.status === 'unverified' ? 'text-red-600' : 'text-gray-900'
                  }`}>{slot.status}</span>
                </div>
                {slot.is_pwd && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">PWD Slot:</span>
                    <span className="font-medium text-info">Yes</span>
                  </div>
                )}
              </div>
            </div>

            {/* Agent State */}
            {agentState && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Camera size={18} />
                  Agent State
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">State:</span>
                    <span className="font-medium">{agentState.state}</span>
                  </div>
                  {agentState.expected_plate && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Expected Plate:</span>
                      <span className="font-medium">{agentState.expected_plate}</span>
                    </div>
                  )}
                  {agentState.detected_plate && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Detected Plate:</span>
                      <span className="font-medium">{agentState.detected_plate}</span>
                    </div>
                  )}
                  {agentState.confidence && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Confidence:</span>
                      <span className="font-medium">{(agentState.confidence * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {agentState.last_frame_url && (
                    <div className="mt-3">
                      <span className="text-gray-600 block mb-2">Last Frame:</span>
                      <img src={agentState.last_frame_url} alt="Last frame" className="w-full rounded-lg" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reservation */}
            {reservation && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText size={18} />
                  Reservation
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Booking Code:</span>
                    <span className="font-medium">{reservation.booking_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Start Time:</span>
                    <span className="font-medium">{new Date(reservation.start_time).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">End Time:</span>
                    <span className="font-medium">{new Date(reservation.end_time).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Vehicle */}
            {vehicle && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Car size={18} />
                  Vehicle
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Plate:</span>
                    <span className="font-medium">{vehicle.plate_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="font-medium">{vehicle.vehicle_type}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Customer */}
            {customer && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User size={18} />
                  Customer
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Name:</span>
                    <span className="font-medium">{customer.full_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Phone:</span>
                    <span className="font-medium">{customer.phone}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            {(slot.status === 'overstay' || slot.status === 'unverified') && (
              <button
                onClick={() => setShowResolveModal(true)}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <CheckCircle size={18} />
                Resolve Alert
              </button>
            )}
            {slot.status === 'reserved' && reservation && (
              <button
                onClick={() => navigate('/slot-assignment', { state: { reservationId: reservation.id } })}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                <ChevronRight size={18} />
                Reassign Slot
              </button>
            )}
            {(slot.status === 'occupied' || slot.status === 'overstay' || slot.status === 'unverified') && reservation && (
              <button
                onClick={() => navigate('/payment', { state: { reservationId: reservation.id } })}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                <LogOut size={18} />
                Release Vehicle (Cash Payment)
              </button>
            )}
          </div>
        </div>

        {/* Resolve Alert Modal */}
        {showResolveModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
            <div className="card max-w-md w-full mx-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Resolve Alert</h3>
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Enter resolution note (required)..."
                className="input w-full h-32 mb-4"
                required
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowResolveModal(false)}
                  className="btn-secondary flex-1"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveAlert}
                  className="btn-primary flex-1"
                  disabled={loading}
                >
                  {loading ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
