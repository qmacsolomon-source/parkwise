import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot, AgentState, Reservation, Profile, Vehicle } from '@parkwise/shared';
import SlotCard from '../components/SlotCard';
import ReservationCard from '../components/ReservationCard';
import { LayoutDashboard, LogOut, RefreshCw, Users, Calendar, AlertTriangle } from 'lucide-react';

export default function Dashboard() {
  const { profile, logout } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [customers, setCustomers] = useState<Record<string, Profile>>({});
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'slots' | 'reservations'>('slots');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    loadData();

    // Subscribe to realtime updates
    const slotsSubscription = supabase
      .channel('slots-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSlots(prev => [...prev, payload.new as Slot]);
        } else if (payload.eventType === 'UPDATE') {
          setSlots(prev => prev.map(s => s.id === payload.new.id ? payload.new as Slot : s));
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
        if (payload.eventType === 'INSERT') {
          setReservations(prev => [...prev, payload.new as Reservation]);
        } else if (payload.eventType === 'UPDATE') {
          setReservations(prev => prev.map(r => r.id === payload.new.id ? payload.new as Reservation : r));
        } else if (payload.eventType === 'DELETE') {
          setReservations(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      slotsSubscription.unsubscribe();
      agentStatesSubscription.unsubscribe();
      reservationsSubscription.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [slotsData, agentStatesData, reservationsData, profilesData, vehiclesData] = await Promise.all([
        supabase.from('slots').select('*').order('slot_code'),
        supabase.from('agent_states').select('*'),
        supabase.from('reservations').select('*').order('created_at', { ascending: false }).limit(20),
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

      if (reservationsData.data) setReservations(reservationsData.data);

      if (profilesData.data) {
        const profilesMap: Record<string, Profile> = {};
        profilesData.data.forEach(p => {
          profilesMap[p.id] = p;
        });
        setCustomers(profilesMap);
      }

      if (vehiclesData.data) {
        const vehiclesMap: Record<string, Vehicle> = {};
        vehiclesData.data.forEach(v => {
          vehiclesMap[v.id] = v;
        });
        setVehicles(vehiclesMap);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
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
              <h1 className="text-xl font-bold text-primary">ParkWise Console</h1>
              <p className="text-sm text-gray-600">Welcome, {profile?.full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              {profile?.role}
            </span>
            <button
              onClick={handleLogoutClick}
              className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('slots')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'slots'
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <LayoutDashboard size={18} />
            Slots
          </button>
          <button
            onClick={() => setActiveTab('reservations')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'reservations'
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Calendar size={18} />
            Reservations
          </button>
        </div>

        {/* Content */}
        {activeTab === 'slots' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Parking Slots ({slots.length})
              </h2>
              <button
                onClick={loadData}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary transition-colors"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {slots.map(slot => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  agentState={agentStates[slot.id]}
                />
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Recent Reservations ({reservations.length})
              </h2>
              <button
                onClick={loadData}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary transition-colors"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reservations.map(reservation => (
                <ReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  customer={customers[reservation.customer_id]}
                  vehicle={vehicles[reservation.vehicle_id]}
                />
              ))}
            </div>
          </div>
        )}
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
