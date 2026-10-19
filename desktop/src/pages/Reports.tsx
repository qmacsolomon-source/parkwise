import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePersistedState } from '../hooks/usePersistedState';
import { supabase } from '@parkwise/shared';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  BarChart3, TrendingUp, Clock, AlertTriangle,
  Download, Calendar, LogOut, Volume2, VolumeX, FileText
} from 'lucide-react';
import jsPDF from 'jspdf';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

interface ReportData {
  revenue: { daily: { date: string; total: number }[] };
  averageStayDuration: number;
  noShows: number;
  overstays: number;
  lateCancellations: number;
  penaltiesIssued: number;
  penaltiesCollected: number;
  verificationResults: { match: number; mismatch: number; low_confidence: number; failed: number };
  alertCount: number;
}

export default function Reports() {
  const { profile, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = usePersistedState('reports:date-from', '');
  const [dateTo, setDateTo] = usePersistedState('reports:date-to', '');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    // Set default date range based on role
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    if (isAdmin) {
      setDateFrom(thirtyDaysAgo.toISOString().split('T')[0]);
      setDateTo(today.toISOString().split('T')[0]);
    } else {
      // Attendant sees only today
      setDateFrom(today.toISOString().split('T')[0]);
      setDateTo(today.toISOString().split('T')[0]);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (dateFrom && dateTo) {
      loadReportData();
    }
  }, [dateFrom, dateTo, isAdmin]);

  const loadReportData = async () => {
    setLoading(true);
    try {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);

      // Fetch payments for revenue
      const { data: payments } = await supabase
        .from('payments')
        .select('*')
        .gte('paid_at', from.toISOString())
        .lte('paid_at', to.toISOString());

      // Fetch reservations for metrics
      const { data: reservations } = await supabase
        .from('reservations')
        .select('*')
        .gte('start_time', from.toISOString())
        .lte('start_time', to.toISOString());

      // Fetch verification events
      const { data: verificationEvents } = await supabase
        .from('verification_events')
        .select('*')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString());

      // Fetch penalties
      const { data: penalties } = await supabase
        .from('penalties')
        .select('*')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString());

      // Calculate revenue by day, sorted chronologically
      const byDay: Record<string, number> = {};
      if (payments) {
        payments.forEach((p: any) => {
          const day = new Date(p.paid_at).toISOString().split('T')[0];
          byDay[day] = (byDay[day] || 0) + p.total;
        });
      }
      const dailyRevenue = Object.keys(byDay)
        .sort()
        .map((date) => ({ date, total: byDay[date] }));

      // Calculate average stay duration
      let totalDuration = 0;
      let completedCount = 0;
      if (reservations) {
        reservations.forEach((r: any) => {
          if (r.end_time && r.start_time) {
            const duration = (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / (1000 * 60 * 60);
            totalDuration += duration;
            completedCount++;
          }
        });
      }
      const averageStayDuration = completedCount > 0 ? totalDuration / completedCount : 0;

      // Count reservation statuses
      let noShows = 0;
      let overstays = 0;
      let lateCancellations = 0;
      if (reservations) {
        reservations.forEach((r: any) => {
          if (r.status === 'no_show') noShows++;
          if (r.status === 'overstay') overstays++;
          if (r.status === 'cancelled') lateCancellations++;
        });
      }

      // Calculate penalties
      let penaltiesIssued = 0;
      let penaltiesCollected = 0;
      if (penalties) {
        penalties.forEach((p: any) => {
          penaltiesIssued += p.amount;
          if (p.status === 'paid') penaltiesCollected += p.amount;
        });
      }

      // Calculate verification results
      let match = 0;
      let mismatch = 0;
      let low_confidence = 0;
      let failed = 0;
      let alertCount = 0;
      if (verificationEvents) {
        verificationEvents.forEach((v: any) => {
          if (v.result === 'match') match++;
          if (v.result === 'mismatch') mismatch++;
          if (v.result === 'low_confidence') low_confidence++;
          if (v.result === 'failed') failed++;
        });
        alertCount = mismatch + failed;
      }

      setReportData({
        revenue: { daily: dailyRevenue },
        averageStayDuration,
        noShows,
        overstays,
        lateCancellations,
        penaltiesIssued,
        penaltiesCollected,
        verificationResults: { match, mismatch, low_confidence, failed },
        alertCount,
      });
    } catch (error) {
      console.error('Error loading report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!reportData) return;

    const headers = ['Metric', 'Value'];
    const rows = [
      ['Average Stay Duration (hours)', reportData.averageStayDuration.toFixed(2)],
      ['No-Shows', reportData.noShows],
      ['Overstays', reportData.overstays],
      ['Late Cancellations', reportData.lateCancellations],
      ['Penalties Issued', reportData.penaltiesIssued.toFixed(2)],
      ['Penalties Collected', reportData.penaltiesCollected.toFixed(2)],
      ['Verification Matches', reportData.verificationResults.match],
      ['Verification Mismatches', reportData.verificationResults.mismatch],
      ['Alert Count', reportData.alertCount],
    ];

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parkwise-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    if (!reportData) return;

    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(20);
    doc.text('ParkWise Reports', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Date Range: ${dateFrom} to ${dateTo}`, 105, 30, { align: 'center' });

    // Summary
    doc.setFontSize(14);
    doc.text('Summary', 20, 50);
    doc.setFontSize(10);
    let y = 60;
    const summary = [
      `Average Stay Duration: ${reportData.averageStayDuration.toFixed(2)} hours`,
      `No-Shows: ${reportData.noShows}`,
      `Overstays: ${reportData.overstays}`,
      `Late Cancellations: ${reportData.lateCancellations}`,
      // "PHP " not the ₱ symbol - jsPDF's default font doesn't have that
      // glyph, see the same note in CashPayment.tsx's receipt generation.
      `Penalties Issued: PHP ${reportData.penaltiesIssued.toFixed(2)}`,
      `Penalties Collected: PHP ${reportData.penaltiesCollected.toFixed(2)}`,
      `Alert Count: ${reportData.alertCount}`,
    ];
    summary.forEach(line => {
      doc.text(line, 20, y);
      y += 10;
    });

    // Verification Results
    y += 10;
    doc.setFontSize(14);
    doc.text('Verification Results', 20, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Matches: ${reportData.verificationResults.match}`, 20, y);
    y += 10;
    doc.text(`Mismatches: ${reportData.verificationResults.mismatch}`, 20, y);
    y += 10;
    doc.text(`Low Confidence: ${reportData.verificationResults.low_confidence}`, 20, y);
    y += 10;
    doc.text(`Failed: ${reportData.verificationResults.failed}`, 20, y);

    doc.save(`parkwise-report-${dateFrom}-to-${dateTo}.pdf`);
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  const verificationPieData = reportData ? [
    { name: 'Match', value: reportData.verificationResults.match },
    { name: 'Mismatch', value: reportData.verificationResults.mismatch },
    { name: 'Low Confidence', value: reportData.verificationResults.low_confidence },
    { name: 'Failed', value: reportData.verificationResults.failed },
  ] : [];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading reports...</p>
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
            <BarChart3 className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Reports</h1>
              <p className="text-sm text-gray-600">Analytics & Insights</p>
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
        {/* Date Range Picker */}
        <div className="card mb-6">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Date Range:</span>
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input"
              disabled={!isAdmin}
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input"
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <span className="text-xs text-gray-500">Attendants can only view today's reports</span>
            )}
          </div>
        </div>

        {reportData && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Average Stay</p>
                    <p className="text-2xl font-bold text-primary">
                      {reportData.averageStayDuration.toFixed(2)}h
                    </p>
                  </div>
                  <Clock className="text-primary" size={32} />
                </div>
              </div>
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">No-Shows</p>
                    <p className="text-2xl font-bold text-red-600">{reportData.noShows}</p>
                  </div>
                  <AlertTriangle className="text-red-600" size={32} />
                </div>
              </div>
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Overstays</p>
                    <p className="text-2xl font-bold text-amber-600">{reportData.overstays}</p>
                  </div>
                  <TrendingUp className="text-amber-600" size={32} />
                </div>
              </div>
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Alerts</p>
                    <p className="text-2xl font-bold text-purple-600">{reportData.alertCount}</p>
                  </div>
                  <AlertTriangle className="text-purple-600" size={32} />
                </div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Revenue Chart */}
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Revenue</h3>
                {reportData.revenue.daily.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">No payments in this date range</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reportData.revenue.daily}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total" name="Revenue" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Verification Results moved up to fill the grid */}
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Results</h3>
                {verificationPieData.every((d) => d.value === 0) ? (
                  <p className="text-sm text-gray-500 py-8 text-center">No verification events in this date range</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={verificationPieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {verificationPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Penalties */}
            <div className="mb-6">
              <div className="card max-w-md">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Penalties</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Issued</span>
                    <span className="text-xl font-bold text-red-600">
                      ₱{reportData.penaltiesIssued.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Collected</span>
                    <span className="text-xl font-bold text-green-600">
                      ₱{reportData.penaltiesCollected.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                    <span className="text-gray-600 font-medium">Collection Rate</span>
                    <span className="text-xl font-bold text-primary">
                      {reportData.penaltiesIssued > 0
                        ? ((reportData.penaltiesCollected / reportData.penaltiesIssued) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Stats */}
            <div className="card mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed Statistics</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Late Cancellations</p>
                  <p className="text-2xl font-bold text-gray-900">{reportData.lateCancellations}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Verification Success Rate</p>
                  <p className="text-2xl font-bold text-green-600">
                    {(reportData.verificationResults.match +
                      reportData.verificationResults.mismatch +
                      reportData.verificationResults.failed) > 0
                      ? ((reportData.verificationResults.match /
                          (reportData.verificationResults.match +
                           reportData.verificationResults.mismatch +
                           reportData.verificationResults.failed)) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Total Revenue</p>
                  <p className="text-2xl font-bold text-primary">
                    ₱{reportData.revenue.daily.reduce((sum, d) => sum + d.total, 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleExportCSV}
                className="btn-secondary flex items-center gap-2"
              >
                <Download size={18} />
                Export CSV
              </button>
              <button
                onClick={handleExportPDF}
                className="btn-secondary flex items-center gap-2"
              >
                <FileText size={18} />
                Export PDF
              </button>
            </div>
          </>
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
