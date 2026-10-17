import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/DialogContext';
import { supabase } from '@parkwise/shared';
import { Slot, AgentState, Reservation, VerificationEvent, Profile, Vehicle } from '@parkwise/shared';
import {
  Camera, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  Clock, Search, Flag, Edit3, LogOut, Volume2, VolumeX
} from 'lucide-react';

const AGENT_SERVICE_URL = 'http://localhost:8000';

export default function PlateVerification() {
  const { profile, logout } = useAuth();
  const dialog = useDialog();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [customers, setCustomers] = useState<Record<string, Profile>>({});
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [verificationHistory, setVerificationHistory] = useState<VerificationEvent[]>([]);
  
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Accept/Override/Flag only ever surfaced feedback on failure - a
  // successful action closed its modal and just... didn't say anything,
  // leaving the attendant to guess whether it actually worked.
  const [successMessage, setSuccessMessage] = useState('');

  const [gracePeriodRemaining, setGracePeriodRemaining] = useState<number>(0);

  // Load initial data
  useEffect(() => {
    loadData();

    // Real-time subscriptions
    const slotsSubscription = supabase
      .channel('slots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setSlots(prev => prev.map(s => s.id === payload.new.id ? payload.new as Slot : s));
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

    const verificationEventsSubscription = supabase
      .channel('verification-events-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'verification_events' }, (payload) => {
        setVerificationHistory(prev => [payload.new as VerificationEvent, ...prev]);
      })
      .subscribe();

    return () => {
      slotsSubscription.unsubscribe();
      agentStatesSubscription.unsubscribe();
      verificationEventsSubscription.unsubscribe();
    };
  }, []);

  // Grace period countdown
  useEffect(() => {
    if (!selectedSlot) return;
    
    const agentState = agentStates[selectedSlot.id];
    if (!agentState || !agentState.accepted_at) return;

    const interval = setInterval(() => {
      const agentState = agentStates[selectedSlot.id];
      if (!agentState || !agentState.accepted_at) return;
      
      const acceptedAt = new Date(agentState.accepted_at);
      const now = new Date();
      const elapsed = (now.getTime() - acceptedAt.getTime()) / 1000;
      const gracePeriod = 60; // 60 seconds
      const remaining = Math.max(0, gracePeriod - elapsed);
      setGracePeriodRemaining(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedSlot, agentStates]);

  const loadData = async () => {
    try {
      const [slotsData, agentStatesData, reservationsData, customersData, vehiclesData, historyData] = await Promise.all([
        supabase.from('slots').select('*').order('slot_code'),
        supabase.from('agent_states').select('*'),
        supabase.from('reservations').select('*').in('status', ['pending', 'active', 'verified']),
        supabase.from('profiles').select('*'),
        supabase.from('vehicles').select('*'),
        supabase.from('verification_events').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      if (slotsData.data) setSlots(slotsData.data);
      
      if (agentStatesData.data) {
        const statesMap: Record<string, AgentState> = {};
        agentStatesData.data.forEach(state => {
          statesMap[state.slot_id] = state;
        });
        setAgentStates(statesMap);
      }

      if (reservationsData.data) setReservations(reservationsData.data);

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

      if (historyData.data) setVerificationHistory(historyData.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptVehicle = async () => {
    if (!selectedSlot || !selectedReservation) return;

    setActionLoading(true);
    try {
      // Call agent service to accept vehicle
      const vehicle = vehicles[selectedReservation.vehicle_id];
      const response = await fetch(`${AGENT_SERVICE_URL}/agents/${selectedSlot.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_plate: vehicle.plate_number }),
      });

      if (!response.ok) throw new Error('Failed to accept vehicle');

      // Update local state
      setSelectedReservation(null);
      setSuccessMessage(`Vehicle accepted for slot ${selectedSlot.slot_code}.`);
      setTimeout(() => setSuccessMessage(''), 4000);
      loadData();
    } catch (error) {
      console.error('Error accepting vehicle:', error);
      await dialog.alert('Failed to accept vehicle');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryCapture = async () => {
    if (!selectedSlot) return;

    setActionLoading(true);
    try {
      // Trigger camera capture via agent service
      await fetch(`${AGENT_SERVICE_URL}/beam/${selectedSlot.id}`, { method: 'POST' });
      setSuccessMessage('Capture retry triggered.');
      setTimeout(() => setSuccessMessage(''), 4000);
      loadData();
    } catch (error) {
      console.error('Error retrying capture:', error);
      await dialog.alert('Failed to retry capture');
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualOverride = async () => {
    if (!overrideReason.trim()) {
      await dialog.alert('Please provide a reason for manual override');
      return;
    }

    setActionLoading(true);
    try {
      // Log to audit
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'manual_override',
        details: {
          slot_id: selectedSlot?.id,
          slot_code: selectedSlot?.slot_code,
          reason: overrideReason,
        },
      });

      setShowManualOverride(false);
      setOverrideReason('');
      setSuccessMessage(`Manual override recorded for slot ${selectedSlot?.slot_code}.`);
      setTimeout(() => setSuccessMessage(''), 4000);
      loadData();
    } catch (error) {
      console.error('Error with manual override:', error);
      await dialog.alert('Failed to record manual override');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFlagUnverified = async () => {
    if (!flagReason.trim()) {
      await dialog.alert('Please provide a reason for flagging');
      return;
    }

    setActionLoading(true);
    try {
      // Update slot status to unverified
      if (selectedSlot) {
        await supabase.from('slots').update({ status: 'unverified' }).eq('id', selectedSlot.id);
        
        // Log to audit
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('audit_log').insert({
          actor_id: user?.id,
          action: 'flag_unverified',
          details: {
            slot_id: selectedSlot.id,
            slot_code: selectedSlot.slot_code,
            reason: flagReason,
          },
        });
      }

      setShowFlagModal(false);
      setFlagReason('');
      setSuccessMessage(`Slot ${selectedSlot?.slot_code} flagged as unverified.`);
      setTimeout(() => setSuccessMessage(''), 4000);
      loadData();
    } catch (error) {
      console.error('Error flagging unverified:', error);
      await dialog.alert('Failed to flag as unverified');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const getVerificationResult = () => {
    if (!selectedSlot) return null;
    const agentState = agentStates[selectedSlot.id];
    if (!agentState || !agentState.detected_plate || !agentState.expected_plate) return null;

    const detected = agentState.detected_plate.toUpperCase();
    const expected = agentState.expected_plate.toUpperCase();
    const match = detected === expected;
    
    return { match, detected, expected, confidence: agentState.confidence };
  };

  const filteredHistory = verificationHistory.filter(event => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      event.detected_plate.toLowerCase().includes(query) ||
      event.expected_plate.toLowerCase().includes(query) ||
      event.slot_id.toLowerCase().includes(query)
    );
  });

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

  const result = getVerificationResult();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Plate Verification</h1>
              <p className="text-sm text-gray-600">Welcome, {profile?.full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Sound alerts on" : "Sound alerts off"}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}
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
        {successMessage && (
          <div className="p-3 bg-green-50 text-green-800 rounded-lg mb-4 flex items-center gap-2">
            <CheckCircle size={18} />
            {successMessage}
          </div>
        )}
        {/* Slot Selection */}
        <div className="card mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Slot</label>
          <select
            value={selectedSlot?.id || ''}
            onChange={(e) => {
              const slot = slots.find(s => s.id === e.target.value);
              setSelectedSlot(slot || null);
              setSelectedReservation(null);
            }}
            className="input"
          >
            <option value="">-- Select a slot --</option>
            {slots.map(slot => (
              <option key={slot.id} value={slot.id}>
                {slot.slot_code} - {slot.status} {slot.is_pwd ? '(PWD)' : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedSlot && (
          <>
            {/* Main Verification Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Left: Camera Frame */}
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Camera size={20} />
                  Live Camera Feed - {selectedSlot.slot_code}
                </h2>
                <div className="aspect-video bg-black rounded-lg flex items-center justify-center relative overflow-hidden">
                  {agentStates[selectedSlot.id]?.last_frame_url ? (
                    <img
                      src={agentStates[selectedSlot.id].last_frame_url}
                      alt="Latest frame"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-gray-500 flex flex-col items-center">
                      <Camera size={48} opacity={0.5} />
                      <p className="mt-2">No frame available</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Verification Results */}
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <CheckCircle size={20} />
                  Verification Results
                </h2>

                {/* Result Banner */}
                {result && (
                  <div className={`p-4 rounded-lg mb-4 flex items-center gap-3 ${
                    result.match ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                  }`}>
                    {result.match ? (
                      <CheckCircle size={24} />
                    ) : (
                      <XCircle size={24} />
                    )}
                    <div>
                      <p className="font-semibold">
                        {result.match ? 'Plate Matched' : 'Plate Mismatch'}
                      </p>
                      <p className="text-sm opacity-90">
                        Confidence: {result.confidence ? (result.confidence * 100).toFixed(1) + '%' : 'N/A'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Grace Period Countdown */}
                {agentStates[selectedSlot.id]?.state === 'verifying' && (
                  <div className="p-4 bg-amber-50 text-amber-800 rounded-lg mb-4 flex items-center gap-3">
                    <Clock size={24} />
                    <div>
                      <p className="font-semibold">Grace Period</p>
                      <p className="text-2xl font-bold">{Math.ceil(gracePeriodRemaining)}s</p>
                    </div>
                  </div>
                )}

                {/* Plate Details */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-600">Expected Plate:</span>
                    <span className="font-mono font-bold text-lg">
                      {agentStates[selectedSlot.id]?.expected_plate || '--'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-600">Detected Plate:</span>
                    <span className="font-mono font-bold text-lg">
                      {agentStates[selectedSlot.id]?.detected_plate || '--'}
                    </span>
                  </div>
                  {agentStates[selectedSlot.id]?.confidence && (
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-600">Confidence:</span>
                      <span className="font-bold">
                        {(agentStates[selectedSlot.id].confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-3 mt-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Reservation (for Accept Vehicle)
                    </label>
                    <select
                      value={selectedReservation?.id || ''}
                      onChange={(e) => {
                        const res = reservations.find(r => r.id === e.target.value);
                        setSelectedReservation(res || null);
                      }}
                      className="input"
                    >
                      <option value="">-- Select reservation --</option>
                      {reservations
                        .filter(r => r.slot_id === selectedSlot.id)
                        .map(reservation => {
                          const vehicle = vehicles[reservation.vehicle_id];
                          const customer = vehicle ? customers[vehicle.owner_id] : null;
                          return (
                            <option key={reservation.id} value={reservation.id}>
                              {reservation.booking_code} - {vehicle?.plate_number} - {customer?.full_name}
                            </option>
                          );
                        })}
                    </select>
                  </div>

                  <button
                    onClick={handleAcceptVehicle}
                    disabled={!selectedReservation || actionLoading}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={18} />
                    Accept Vehicle
                  </button>
                  {!selectedReservation && (
                    <p className="text-xs text-amber-600 -mt-2">
                      Select a reservation above first.
                    </p>
                  )}

                  <button
                    onClick={handleRetryCapture}
                    disabled={actionLoading}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={18} />
                    Retry Capture
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setShowManualOverride(true)}
                      disabled={actionLoading}
                      className="btn-secondary flex items-center justify-center gap-2"
                    >
                      <Edit3 size={18} />
                      Manual Override
                    </button>
                    <button
                      onClick={() => setShowFlagModal(true)}
                      disabled={actionLoading}
                      className="btn-secondary flex items-center justify-center gap-2 text-red-600"
                    >
                      <Flag size={18} />
                      Flag Unverified
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Verification History */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Clock size={20} />
                  Verification History
                </h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    placeholder="Search history..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input pl-10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredHistory.map(event => (
                  <div key={event.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex gap-3">
                      {event.frame_url ? (
                        <img
                          src={event.frame_url}
                          alt="Frame"
                          className="w-20 h-20 object-cover rounded"
                        />
                      ) : (
                        <div className="w-20 h-20 bg-gray-200 rounded flex items-center justify-center">
                          <Camera size={24} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {event.detected_plate}
                        </p>
                        <p className="text-xs text-gray-600">
                          Expected: {event.expected_plate}
                        </p>
                        <p className="text-xs text-gray-600">
                          Confidence: {(event.confidence * 100).toFixed(1)}%
                        </p>
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs mt-1 ${
                          event.result === 'match' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {event.result}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredHistory.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Clock size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No verification history found</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Manual Override Modal */}
      {showManualOverride && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Manual Override</h3>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Enter reason for manual override (required)..."
              className="input w-full h-32 mb-4"
              required
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowManualOverride(false);
                  setOverrideReason('');
                }}
                className="btn-secondary flex-1"
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleManualOverride}
                className="btn-primary flex-1"
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Unverified Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Flag as Unverified</h3>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Enter reason for flagging (required)..."
              className="input w-full h-32 mb-4"
              required
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowFlagModal(false);
                  setFlagReason('');
                }}
                className="btn-secondary flex-1"
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleFlagUnverified}
                className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Flag'}
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
