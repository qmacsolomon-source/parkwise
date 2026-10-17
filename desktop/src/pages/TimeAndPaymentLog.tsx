import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDialog } from '../contexts/DialogContext';
import { supabase } from '@parkwise/shared';
import { Reservation, Payment, Profile, Vehicle, Slot, VerificationEvent } from '@parkwise/shared';
import {
  FileText, Search, Download, ChevronLeft, ChevronRight,
  AlertTriangle, LogOut, Volume2, VolumeX, Edit3, X, Camera
} from 'lucide-react';

interface LogEntry {
  id: string;
  plate: string;
  slot: string;
  customer: string;
  timeIn: string;
  timeOut: string | null;
  duration: string;
  baseCharge: number;
  surcharge: number;
  penalty: number;
  total: number;
  attendant: string | null;
  status: string;
  reservationId: string;
  annotation: string | null;
}

export default function TimeAndPaymentLog() {
  const { profile, logout } = useAuth();
  const dialog = useDialog();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('timeIn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [verificationEvents, setVerificationEvents] = useState<VerificationEvent[]>([]);
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadData();
  }, [searchQuery, statusFilter, dateFrom, dateTo, sortBy, sortOrder, currentPage]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Build query with filters
      let query = supabase
        .from('reservations')
        .select(`
          *,
          payments(*, attendant:profiles!payments_attendant_id_fkey(full_name)),
          profiles!reservations_customer_id_fkey(*),
          vehicles!reservations_vehicle_id_fkey(*),
          slots!reservations_slot_id_fkey(*)
        `, { count: 'exact' })
        .in('status', ['completed', 'cancelled', 'no_show']);

      // Apply date range filter
      if (dateFrom) {
        query = query.gte('start_time', dateFrom);
      }
      if (dateTo) {
        query = query.lte('start_time', dateTo + 'T23:59:59');
      }

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // Apply search
      // Note: searching by customer name / plate number would require filtering on
      // joined tables (profiles/vehicles). PostgREST rejects that inside an `.or()`
      // unless those embeds are forced to an inner join, which would also silently
      // drop any reservation with a missing customer or vehicle link from every
      // query (not just search). Rather than risk that regression, search is
      // scoped to `booking_code`, a column on `reservations` itself, which works
      // reliably. Full plate/customer search would need a DB-side view or RPC.
      if (searchQuery) {
        query = query.ilike('booking_code', `%${searchQuery}%`);
      }

      // Apply sorting
      // Note: only columns that live directly on the `reservations` table can be
      // sorted server-side via PostgREST. Columns from joined tables (plate,
      // customer, total) can't be used with a plain `.order()` call without a
      // DB-level view/RPC, so sorting by those is intentionally not offered.
      const columnMap: Record<string, string> = {
        timeIn: 'start_time',
        timeOut: 'end_time',
      };
      const sortColumn = columnMap[sortBy] || 'start_time';
      query = query.order(sortColumn, { ascending: sortOrder === 'asc' });

      // Apply pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      setTotalCount(count || 0);

      // Transform data to log entries
      const logEntries: LogEntry[] = (data || []).map((item: any) => {
        const reservation = item as Reservation;
        // payments.reservation_id has no UNIQUE constraint, so PostgREST
        // treats reservations -> payments as one-to-many and always embeds
        // it as an array, even though there's only ever one payment per
        // reservation in practice (CashPayment checks for an existing one
        // before inserting). Treating that array as a single object made
        // every .base_charge/.total/etc access silently undefined, which
        // is why every row in this log showed $0.00 regardless of what was
        // actually paid.
        const paymentsEmbed = item.payments as (Payment & { attendant?: { full_name: string } })[] | null;
        const payment = paymentsEmbed?.[0] || null;
        const customer = item.profiles as Profile;
        const vehicle = item.vehicles as Vehicle;
        const slot = item.slots as Slot;
        const attendant = payment?.attendant?.full_name || null;

        const startTime = new Date(reservation.start_time);
        const endTime = reservation.end_time ? new Date(reservation.end_time) : null;
        const duration = endTime 
          ? Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60))
          : 0;

        return {
          id: reservation.id,
          plate: vehicle?.plate_number || 'N/A',
          slot: slot?.slot_code || 'N/A',
          customer: customer?.full_name || 'N/A',
          timeIn: reservation.start_time,
          timeOut: reservation.end_time,
          duration: duration > 0 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : 'N/A',
          baseCharge: payment?.base_charge || 0,
          surcharge: payment?.overstay_surcharge || 0,
          penalty: payment?.penalty_total || 0,
          total: payment?.total || 0,
          attendant: attendant,
          status: reservation.status,
          reservationId: reservation.id,
          annotation: reservation.annotation || null,
        };
      });

      setEntries(logEntries);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const handleRowClick = async (entry: LogEntry) => {
    setSelectedEntry(entry);
    setShowDrawer(true);

    try {
      const { data } = await supabase
        .from('verification_events')
        .select('*')
        .eq('reservation_id', entry.reservationId)
        .order('created_at', { ascending: true });

      setVerificationEvents(data || []);
    } catch (error) {
      console.error('Error loading verification events:', error);
    }
  };

  const handleSaveAnnotation = async () => {
    if (!selectedEntry) return;

    setSavingAnnotation(true);
    try {
      const { error } = await supabase
        .from('reservations')
        .update({ annotation: annotationText })
        .eq('id', selectedEntry.reservationId);

      if (error) throw error;

      // Update local state
      setEntries(prev => prev.map(e =>
        e.id === selectedEntry.id ? { ...e, annotation: annotationText } : e
      ));
      setSelectedEntry(prev => prev ? { ...prev, annotation: annotationText } : prev);

      setShowAnnotationModal(false);
      setAnnotationText('');
    } catch (error) {
      console.error('Error saving annotation:', error);
      await dialog.alert('Failed to save annotation');
    } finally {
      setSavingAnnotation(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['Plate', 'Slot', 'Customer', 'Time In', 'Time Out', 'Duration', 'Base Charge', 'Surcharge', 'Penalty', 'Total', 'Attendant', 'Status', 'Annotation'];
    const rows = entries.map(entry => [
      entry.plate,
      entry.slot,
      entry.customer,
      entry.timeIn,
      entry.timeOut || 'N/A',
      entry.duration,
      entry.baseCharge.toFixed(2),
      entry.surcharge.toFixed(2),
      entry.penalty.toFixed(2),
      entry.total.toFixed(2),
      entry.attendant,
      entry.status,
      entry.annotation || '',
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parkwise-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Time and Payment Log</h1>
              <p className="text-sm text-gray-600">Welcome, {profile?.full_name}</p>
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
        {/* Filters */}
        <div className="card mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search by booking code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input md:w-auto md:max-w-[180px] flex-shrink-0"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input md:w-auto md:max-w-[160px] flex-shrink-0"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input md:w-auto md:max-w-[160px] flex-shrink-0"
            />
            <button
              onClick={handleExportCSV}
              className="btn-secondary flex items-center gap-2"
            >
              <Download size={18} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Plate
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Slot
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Customer
                </th>
                <th
                  onClick={() => handleSort('timeIn')}
                  className="px-4 py-3 text-left text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-50"
                >
                  Time In {sortBy === 'timeIn' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  onClick={() => handleSort('timeOut')}
                  className="px-4 py-3 text-left text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-50"
                >
                  Time Out {sortBy === 'timeOut' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Duration
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                  Base
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                  Surcharge
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                  Penalty
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Attendant
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Status
                </th>
                {isAdmin && (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Annotation
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 13 : 12} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 13 : 12} className="px-4 py-8 text-center text-gray-500">
                    No entries found
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => handleRowClick(entry)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-sm font-mono">{entry.plate}</td>
                    <td className="px-4 py-3 text-sm">{entry.slot}</td>
                    <td className="px-4 py-3 text-sm">{entry.customer}</td>
                    <td className="px-4 py-3 text-sm">
                      {new Date(entry.timeIn).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {entry.timeOut ? new Date(entry.timeOut).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm">{entry.duration}</td>
                    <td className="px-4 py-3 text-sm text-right">${entry.baseCharge.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-red-600">
                      {entry.surcharge > 0 ? `$${entry.surcharge.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600">
                      {entry.penalty > 0 ? `$${entry.penalty.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold">
                      ${entry.total.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm">{entry.attendant || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        entry.status === 'completed' ? 'bg-green-100 text-green-800' :
                        entry.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-sm max-w-xs truncate">
                        {entry.annotation || '-'}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="btn-secondary px-3 py-1"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="btn-secondary px-3 py-1"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {showDrawer && selectedEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
          <div className="bg-white h-full w-full max-w-2xl shadow-xl overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-primary">Stay Details</h2>
                <button onClick={() => setShowDrawer(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X size={24} />
                </button>
              </div>

              {/* Entry Summary */}
              <div className="card mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Plate:</span>
                    <span className="ml-2 font-medium">{selectedEntry.plate}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Slot:</span>
                    <span className="ml-2 font-medium">{selectedEntry.slot}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Customer:</span>
                    <span className="ml-2 font-medium">{selectedEntry.customer}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Duration:</span>
                    <span className="ml-2 font-medium">{selectedEntry.duration}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Total:</span>
                    <span className="ml-2 font-bold">${selectedEntry.total.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Status:</span>
                    <span className="ml-2">{selectedEntry.status}</span>
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-gray-600">Annotation:</span>
                        <span className="ml-2">{selectedEntry.annotation || 'None'}</span>
                      </div>
                      <button
                        onClick={() => {
                          setAnnotationText(selectedEntry.annotation || '');
                          setShowAnnotationModal(true);
                        }}
                        className="btn-secondary px-3 py-1 text-sm flex items-center gap-1"
                      >
                        <Edit3 size={14} />
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Verification Events */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Camera size={18} />
                  Verification Events
                </h3>
                {verificationEvents.length === 0 ? (
                  <p className="text-sm text-gray-500">No verification events recorded</p>
                ) : (
                  <div className="space-y-4">
                    {verificationEvents.map((event) => (
                      <div key={event.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex gap-4">
                          {event.frame_url ? (
                            <img
                              src={event.frame_url}
                              alt="Frame"
                              className="w-32 h-24 object-cover rounded"
                            />
                          ) : (
                            <div className="w-32 h-24 bg-gray-200 rounded flex items-center justify-center">
                              <Camera size={24} className="text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-semibold text-sm">
                                  {event.detected_plate}
                                </p>
                                <p className="text-xs text-gray-600">
                                  Expected: {event.expected_plate}
                                </p>
                              </div>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                event.result === 'match' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {event.result}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600">
                              Confidence: {(event.confidence * 100).toFixed(1)}%
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(event.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Annotation Modal */}
      {showAnnotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Add Annotation</h3>
            <textarea
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              placeholder="Enter annotation details..."
              className="input w-full h-32 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAnnotationModal(false);
                  setAnnotationText('');
                }}
                className="btn-secondary flex-1"
                disabled={savingAnnotation}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAnnotation}
                className="btn-primary flex-1"
                disabled={savingAnnotation}
              >
                {savingAnnotation ? 'Saving...' : 'Save'}
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
