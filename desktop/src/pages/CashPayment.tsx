import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Slot, Reservation, Rate, Penalty, Profile, Vehicle } from '@parkwise/shared';
import {
  DollarSign, AlertTriangle, CheckCircle,
  Receipt, Printer, RefreshCw, LogOut, Bell
} from 'lucide-react';
import jsPDF from 'jspdf';

const AGENT_SERVICE_URL = 'http://localhost:8000';

interface PaymentCalculation {
  baseCharge: number;
  overstaySurcharge: number;
  penaltyTotal: number;
  total: number;
  overstayHours: number;
}

export default function CashPayment() {
  const { profile, logout } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [rates, setRates] = useState<Rate | null>(null);
  const [customers, setCustomers] = useState<Record<string, Profile>>({});
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [penalties, setPenalties] = useState<Record<string, Penalty[]>>({});
  
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [calculation, setCalculation] = useState<PaymentCalculation | null>(null);
  const [amountReceived, setAmountReceived] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [reservationsData, slotsData, ratesData, customersData, vehiclesData, penaltiesData] = await Promise.all([
        supabase.from('reservations').select('*').in('status', ['active', 'verified', 'overstay']),
        supabase.from('slots').select('*'),
        supabase.from('rates').select('*').single(),
        supabase.from('profiles').select('*'),
        supabase.from('vehicles').select('*'),
        supabase.from('penalties').select('*').eq('status', 'unpaid'),
      ]);

      if (reservationsData.data) setReservations(reservationsData.data);
      
      if (slotsData.data) {
        const slotsMap: Record<string, Slot> = {};
        slotsData.data.forEach(slot => {
          slotsMap[slot.id] = slot;
        });
        setSlots(slotsMap);
      }

      if (ratesData.data) setRates(ratesData.data);

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

      if (penaltiesData.data) {
        const penaltiesMap: Record<string, Penalty[]> = {};
        penaltiesData.data.forEach(penalty => {
          if (!penaltiesMap[penalty.customer_id]) {
            penaltiesMap[penalty.customer_id] = [];
          }
          penaltiesMap[penalty.customer_id].push(penalty);
        });
        setPenalties(penaltiesMap);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const calculatePayment = (reservation: Reservation): PaymentCalculation => {
    if (!rates) {
      throw new Error('Rates not loaded');
    }

    const startTime = new Date(reservation.start_time);
    const endTime = new Date(reservation.end_time);
    const now = new Date();
    
    // Calculate reserved hours
    const reservedHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    const baseCharge = Math.max(0, reservedHours * rates.hourly_rate);

    // Calculate overstay
    let overstayHours = 0;
    let overstaySurcharge = 0;
    
    if (now > endTime) {
      overstayHours = (now.getTime() - endTime.getTime()) / (1000 * 60 * 60);
      // Round up to nearest hour for overstay
      const roundedOverstayHours = Math.ceil(overstayHours);
      overstaySurcharge = roundedOverstayHours * rates.overstay_per_hour;
    }

    // Calculate penalties
    const customerPenalties = penalties[reservation.customer_id] || [];
    const penaltyTotal = customerPenalties.reduce((sum, p) => sum + p.amount, 0);

    const total = baseCharge + overstaySurcharge + penaltyTotal;

    return {
      baseCharge,
      overstaySurcharge,
      penaltyTotal,
      total,
      overstayHours,
    };
  };

  const handleReservationSelect = (reservation: Reservation) => {
    try {
      const calc = calculatePayment(reservation);
      setCalculation(calc);
      setSelectedReservation(reservation);
      setAmountReceived('');
      setError('');
      setSuccess(false);
    } catch (err) {
      setError('Failed to calculate payment');
    }
  };

  const handleConfirmPayment = async () => {
    if (!selectedReservation || !calculation) return;

    const received = parseFloat(amountReceived);
    if (isNaN(received) || received < calculation.total) {
      setError('Amount received must be at least the total');
      return;
    }

    setProcessing(true);
    setError('');

    try {
      // Check for existing payment (prevent double payment)
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('*')
        .eq('reservation_id', selectedReservation.id)
        .single();

      if (existingPayment) {
        setError('This reservation has already been paid');
        setProcessing(false);
        return;
      }

      // Generate receipt number
      const receiptNum = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      setReceiptNumber(receiptNum);

      const { data: { user } } = await supabase.auth.getUser();
      const change = received - calculation.total;

      // Create payment record
      const { error: paymentError } = await supabase.from('payments').insert({
        reservation_id: selectedReservation.id,
        base_charge: calculation.baseCharge,
        overstay_surcharge: calculation.overstaySurcharge,
        penalty_total: calculation.penaltyTotal,
        total: calculation.total,
        amount_received: received,
        change_given: change,
        attendant_id: user?.id,
        paid_at: new Date().toISOString(),
      });

      if (paymentError) throw paymentError;

      // Mark penalties as paid
      const customerPenalties = penalties[selectedReservation.customer_id] || [];
      for (const penalty of customerPenalties) {
        await supabase.from('penalties').update({ status: 'paid' }).eq('id', penalty.id);
      }

      // Complete reservation
      await supabase.from('reservations').update({ status: 'completed' }).eq('id', selectedReservation.id);

      // Free the slot
      await supabase.from('slots').update({ 
        status: 'available',
        current_reservation_id: null 
      }).eq('id', selectedReservation.slot_id);

      // Reset agent
      await fetch(`${AGENT_SERVICE_URL}/agents/${selectedReservation.slot_id}/release`, { method: 'POST' });

      // Log to audit
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'payment_completed',
        details: {
          reservation_id: selectedReservation.id,
          receipt_number: receiptNum,
          amount: calculation.total,
        },
      });

      setSuccess(true);
      
      // Generate and print receipt
      generatePDF(receiptNum, calculation, change);

      // Refresh data
      loadData();
      setSelectedReservation(null);
      setCalculation(null);
      setAmountReceived('');
    } catch (err) {
      console.error('Payment error:', err);
      setError('Failed to process payment');
    } finally {
      setProcessing(false);
    }
  };

  const generatePDF = (receiptNum: string, calc: PaymentCalculation, change: number) => {
    if (!selectedReservation) return;

    const doc = new jsPDF();
    const customer = customers[selectedReservation.customer_id];
    const vehicle = vehicles[selectedReservation.vehicle_id];
    const slot = slots[selectedReservation.slot_id];

    // Header
    doc.setFontSize(20);
    doc.text('ParkWise Parking', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text('Official Receipt', 105, 30, { align: 'center' });

    // Receipt number
    doc.setFontSize(10);
    doc.text(`Receipt #: ${receiptNum}`, 20, 45);
    doc.text(`Date: ${new Date().toLocaleString()}`, 20, 52);

    // Customer info
    doc.setFontSize(11);
    doc.text('Customer Information', 20, 65);
    doc.setFontSize(10);
    doc.text(`Name: ${customer?.full_name || 'N/A'}`, 20, 72);
    doc.text(`Phone: ${customer?.phone || 'N/A'}`, 20, 79);

    // Vehicle info
    doc.setFontSize(11);
    doc.text('Vehicle Information', 20, 92);
    doc.setFontSize(10);
    doc.text(`Plate: ${vehicle?.plate_number || 'N/A'}`, 20, 99);
    doc.text(`Slot: ${slot?.slot_code || 'N/A'}`, 20, 106);

    // Reservation info
    doc.setFontSize(11);
    doc.text('Reservation Details', 20, 119);
    doc.setFontSize(10);
    doc.text(`Start: ${new Date(selectedReservation.start_time).toLocaleString()}`, 20, 126);
    doc.text(`End: ${new Date(selectedReservation.end_time).toLocaleString()}`, 20, 133);

    // Line
    doc.line(20, 140, 190, 140);

    // Charges
    doc.setFontSize(11);
    doc.text('Payment Breakdown', 20, 150);
    doc.setFontSize(10);
    doc.text(`Base Charge (${rates?.hourly_rate.toFixed(2)}/hr)`, 20, 160);
    doc.text(`$${calc.baseCharge.toFixed(2)}`, 170, 160, { align: 'right' });
    
    if (calc.overstaySurcharge > 0) {
      doc.text(`Overstay Surcharge (${calc.overstayHours.toFixed(2)} hrs)`, 20, 167);
      doc.text(`$${calc.overstaySurcharge.toFixed(2)}`, 170, 167, { align: 'right' });
    }
    
    if (calc.penaltyTotal > 0) {
      doc.text(`Penalties`, 20, 174);
      doc.text(`$${calc.penaltyTotal.toFixed(2)}`, 170, 174, { align: 'right' });
    }

    // Line
    doc.line(20, 180, 190, 180);

    // Total
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('TOTAL', 20, 190);
    doc.text(`$${calc.total.toFixed(2)}`, 170, 190, { align: 'right' });
    doc.setFont(undefined, 'normal');

    // Payment
    doc.setFontSize(10);
    doc.text(`Amount Received`, 20, 205);
    doc.text(`$${parseFloat(amountReceived).toFixed(2)}`, 170, 205, { align: 'right' });
    doc.text(`Change`, 20, 212);
    doc.text(`$${change.toFixed(2)}`, 170, 212, { align: 'right' });

    // Footer
    doc.setFontSize(8);
    doc.text('Thank you for using ParkWise!', 105, 280, { align: 'center' });

    // Save and print
    doc.save(`receipt-${receiptNum}.pdf`);
    window.print();
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
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

  const change = calculation && amountReceived ? parseFloat(amountReceived) - calculation.total : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Cash Payment</h1>
              <p className="text-sm text-gray-600">Welcome, {profile?.full_name}</p>
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
          {/* Left: Select Reservation */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Receipt size={20} />
              Select Reservation
            </h2>
            
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {reservations.map(reservation => {
                const customer = customers[reservation.customer_id];
                const vehicle = vehicles[reservation.vehicle_id];
                const slot = slots[reservation.slot_id];
                
                return (
                  <div
                    key={reservation.id}
                    onClick={() => handleReservationSelect(reservation)}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedReservation?.id === reservation.id
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{reservation.booking_code}</p>
                        <p className="text-sm text-gray-600">
                          {customer?.full_name} - {vehicle?.plate_number}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        reservation.status === 'overstay' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {reservation.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <p>Slot: {slot?.slot_code}</p>
                      <p>End: {new Date(reservation.end_time).toLocaleString()}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {reservations.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                <p>No active reservations</p>
              </div>
            )}
          </div>

          {/* Right: Payment Details */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign size={20} />
              Payment Details
            </h2>

            {success && (
              <div className="mb-4 p-4 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
                <CheckCircle size={20} />
                <div>
                  <p className="font-semibold">Payment Successful</p>
                  <p className="text-sm">Receipt: {receiptNumber}</p>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
                <AlertTriangle size={20} />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {calculation && selectedReservation && (
              <>
                {/* Itemized Receipt */}
                <div className="border-b border-gray-200 pb-4 mb-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Itemized Receipt</h3>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Base Charge</span>
                      <span className="font-medium">${calculation.baseCharge.toFixed(2)}</span>
                    </div>
                    
                    {calculation.overstaySurcharge > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">
                          Overstay Surcharge ({calculation.overstayHours.toFixed(2)} hrs)
                        </span>
                        <span className="font-medium text-red-600">${calculation.overstaySurcharge.toFixed(2)}</span>
                      </div>
                    )}
                    
                    {calculation.penaltyTotal > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Penalties</span>
                        <span className="font-medium text-red-600">${calculation.penaltyTotal.toFixed(2)}</span>
                      </div>
                    )}
                    
                    <div className="border-t border-gray-200 pt-2 mt-2">
                      <div className="flex justify-between text-lg font-bold">
                        <span>Total</span>
                        <span className="text-primary">${calculation.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Amount Received */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount Received
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      className="input pl-8 text-lg font-bold"
                      placeholder="0.00"
                      disabled={processing}
                    />
                  </div>
                  {amountReceived && calculation && (
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-gray-600">Change:</span>
                      <span className={`font-bold ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ${change.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={handleConfirmPayment}
                  disabled={!amountReceived || parseFloat(amountReceived) < calculation.total || processing}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={18} />
                      Confirm Payment
                    </>
                  )}
                </button>

                {/* Print Receipt Button */}
                {success && (
                  <button
                    onClick={() => generatePDF(receiptNumber, calculation, change)}
                    className="btn-secondary w-full flex items-center justify-center gap-2 mt-3"
                  >
                    <Printer size={18} />
                    Print Receipt Again
                  </button>
                )}
              </>
            )}

            {!calculation && (
              <div className="text-center py-8 text-gray-500">
                <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                <p>Select a reservation to calculate payment</p>
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
