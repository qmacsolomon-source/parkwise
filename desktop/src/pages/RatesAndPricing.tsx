import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import { Rate } from '@parkwise/shared';
import {
  DollarSign, AlertTriangle, CheckCircle, LogOut, Bell,
  RotateCcw, History, Clock, Shield
} from 'lucide-react';

const DEFAULT_RATES = {
  hourly_rate: 50,
  overstay_per_hour: 75,
  no_show_penalty: 100,
  late_cancel_penalty: 50,
  late_cancel_window_minutes: 30,
  grace_period_minutes: 15,
};

export default function RatesAndPricing() {
  const { profile, logout } = useAuth();
  const [rates, setRates] = useState<Rate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [rateHistory, setRateHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [formRates, setFormRates] = useState({
    hourly_rate: '',
    overstay_per_hour: '',
    no_show_penalty: '',
    late_cancel_penalty: '',
    late_cancel_window_minutes: '',
    grace_period_minutes: '',
  });

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadRates();
    loadRateHistory();
  }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('rates')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setRates(data);
        setFormRates({
          hourly_rate: data.hourly_rate.toString(),
          overstay_per_hour: data.overstay_per_hour.toString(),
          no_show_penalty: data.no_show_penalty.toString(),
          late_cancel_penalty: data.late_cancel_penalty.toString(),
          late_cancel_window_minutes: data.late_cancel_window_minutes.toString(),
          grace_period_minutes: data.grace_period_minutes.toString(),
        });
      }
    } catch (error: any) {
      console.error('Error loading rates:', error);
      setError(error.message || 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  };

  const loadRateHistory = async () => {
    try {
      const { data } = await supabase
        .from('audit_log')
        .select('*')
        .eq('action', 'rates_updated')
        .order('created_at', { ascending: false })
        .limit(20);

      setRateHistory(data || []);
    } catch (error) {
      console.error('Error loading rate history:', error);
    }
  };

  const validateRates = (): boolean => {
    const hourly = parseFloat(formRates.hourly_rate);
    const overstay = parseFloat(formRates.overstay_per_hour);
    const noShow = parseFloat(formRates.no_show_penalty);
    const lateCancel = parseFloat(formRates.late_cancel_penalty);
    const cancelWindow = parseInt(formRates.late_cancel_window_minutes);
    const grace = parseInt(formRates.grace_period_minutes);

    if (isNaN(hourly) || hourly <= 0) {
      setError('Hourly rate must be a positive number');
      return false;
    }

    if (isNaN(overstay) || overstay < 0) {
      setError('Overstay surcharge must be a non-negative number');
      return false;
    }

    if (isNaN(noShow) || noShow < 0) {
      setError('No-show penalty must be a non-negative number');
      return false;
    }

    if (isNaN(lateCancel) || lateCancel < 0) {
      setError('Late cancellation penalty must be a non-negative number');
      return false;
    }

    if (isNaN(cancelWindow) || cancelWindow < 0) {
      setError('Late cancellation window must be a non-negative number');
      return false;
    }

    if (isNaN(grace) || grace < 0) {
      setError('Grace period must be a non-negative number');
      return false;
    }

    if (cancelWindow > 1440) {
      setError('Late cancellation window cannot exceed 24 hours (1440 minutes)');
      return false;
    }

    if (grace > 60) {
      setError('Grace period cannot exceed 60 minutes');
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateRates()) return;

    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const newRates = {
        hourly_rate: parseFloat(formRates.hourly_rate),
        overstay_per_hour: parseFloat(formRates.overstay_per_hour),
        no_show_penalty: parseFloat(formRates.no_show_penalty),
        late_cancel_penalty: parseFloat(formRates.late_cancel_penalty),
        late_cancel_window_minutes: parseInt(formRates.late_cancel_window_minutes),
        grace_period_minutes: parseInt(formRates.grace_period_minutes),
        updated_by: user?.id,
      };

      // Update or insert rates
      if (rates) {
        await supabase
          .from('rates')
          .update(newRates)
          .eq('id', rates.id);
      } else {
        await supabase
          .from('rates')
          .insert(newRates);
      }

      // Log to audit_log
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'rates_updated',
        details: {
          old_rates: rates,
          new_rates: newRates,
        },
      });

      setSuccess(true);
      setShowSaveModal(false);
      await loadRates();
      await loadRateHistory();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error saving rates:', error);
      setError(error.message || 'Failed to save rates');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const defaultRates = {
        ...DEFAULT_RATES,
        updated_by: user?.id,
      };

      if (rates) {
        await supabase
          .from('rates')
          .update(defaultRates)
          .eq('id', rates.id);
      } else {
        await supabase
          .from('rates')
          .insert(defaultRates);
      }

      // Log to audit_log
      await supabase.from('audit_log').insert({
        actor_id: user?.id,
        action: 'rates_reset',
        details: {
          reset_to: DEFAULT_RATES,
        },
      });

      setSuccess(true);
      setShowResetModal(false);
      await loadRates();
      await loadRateHistory();

      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error resetting rates:', error);
      setError(error.message || 'Failed to reset rates');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
  };

  // Calculate preview
  const calculatePreview = (): string => {
    const hourly = parseFloat(formRates.hourly_rate) || 0;
    const overstay = parseFloat(formRates.overstay_per_hour) || 0;
    const hours = 2;
    const overstayMinutes = 30;
    const overstayHours = overstayMinutes / 60;
    
    const baseCharge = hours * hourly;
    const overstayCharge = overstayHours * overstay;
    const total = baseCharge + overstayCharge;
    
    return `2 hours + 30 min overstay = ₱${total.toFixed(2)}`;
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="card max-w-md w-full mx-4 text-center">
          <Shield className="text-red-600 mx-auto mb-4" size={48} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">This page is only accessible to administrators.</p>
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
            <DollarSign className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Rates and Pricing</h1>
              <p className="text-sm text-gray-600">Manage Parking Rates</p>
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

      <div className="max-w-4xl mx-auto px-4 py-6">
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

        {/* Current Rates */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Current Rates</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary"
              >
                <History size={16} />
                {showHistory ? 'Hide History' : 'View History'}
              </button>
              <button
                onClick={() => setShowResetModal(true)}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary"
              >
                <RotateCcw size={16} />
                Reset to Default
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hourly Rate (₱) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.hourly_rate}
                  onChange={(e) => setFormRates({ ...formRates, hourly_rate: e.target.value })}
                  className="input"
                  min="0"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Base charge per hour of parking</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Overstay Surcharge per Hour (₱) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.overstay_per_hour}
                  onChange={(e) => setFormRates({ ...formRates, overstay_per_hour: e.target.value })}
                  className="input"
                  min="0"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Additional charge for exceeding reservation time</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  No-Show Penalty (₱) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.no_show_penalty}
                  onChange={(e) => setFormRates({ ...formRates, no_show_penalty: e.target.value })}
                  className="input"
                  min="0"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Penalty for not showing up to reservation</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Late Cancellation Penalty (₱) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.late_cancel_penalty}
                  onChange={(e) => setFormRates({ ...formRates, late_cancel_penalty: e.target.value })}
                  className="input"
                  min="0"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Penalty for cancelling within the window</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Late Cancellation Window (minutes) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.late_cancel_window_minutes}
                  onChange={(e) => setFormRates({ ...formRates, late_cancel_window_minutes: e.target.value })}
                  className="input"
                  min="0"
                  max="1440"
                />
                <p className="text-xs text-gray-500 mt-1">Time before start when cancellation is considered late</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Grace Period (minutes) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formRates.grace_period_minutes}
                  onChange={(e) => setFormRates({ ...formRates, grace_period_minutes: e.target.value })}
                  className="input"
                  min="0"
                  max="60"
                />
                <p className="text-xs text-gray-500 mt-1">Grace period after reservation end time</p>
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={18} className="text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Preview Calculation</span>
            </div>
            <p className="text-sm text-blue-800">{calculatePreview()}</p>
          </div>

          {/* Save Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => {
                if (validateRates()) {
                  setShowSaveModal(true);
                }
              }}
              className="btn-primary flex items-center gap-2"
            >
              Save Changes
            </button>
          </div>
        </div>

        {/* Rate History */}
        {showHistory && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Rate Change History</h2>
            {rateHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No rate changes recorded</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {rateHistory.map((entry) => (
                  <div key={entry.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        {entry.details.new_rates ? 'Rates Updated' : 'Rates Reset'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {entry.details.new_rates && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>Hourly: ₱{entry.details.new_rates.hourly_rate}</div>
                          <div>Overstay: ₱{entry.details.new_rates.overstay_per_hour}/hr</div>
                          <div>No-Show: ₱{entry.details.new_rates.no_show_penalty}</div>
                          <div>Late Cancel: ₱{entry.details.new_rates.late_cancel_penalty}</div>
                        </div>
                      )}
                      {entry.details.reset_to && (
                        <div className="text-xs">Reset to default values</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Information */}
        <div className="card mt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 mt-0.5" size={20} />
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Important Notice</h3>
              <p className="text-sm text-gray-600">
                New rates will only apply to <strong>future reservations</strong>. Existing reservations 
                will continue to use the rates that were in effect at the time of booking.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Confirmation Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <DollarSign className="text-blue-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Confirm Rate Changes</h3>
              <p className="text-gray-600">
                Are you sure you want to save these rate changes? New rates will only apply to future reservations.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowSaveModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving...' : 'Confirm Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="card max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <RotateCcw className="text-amber-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Reset to Default</h3>
              <p className="text-gray-600">
                Are you sure you want to reset all rates to default values?
                <br />
                <span className="text-sm text-gray-500 mt-2 block">
                  Hourly: ₱50, Overstay: ₱75/hr, No-Show: ₱100, Late Cancel: ₱50, Window: 30min, Grace: 15min
                </span>
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowResetModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleReset} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Resetting...' : 'Reset to Default'}
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
              <button onClick={() => setShowLogoutModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleLogout} className="btn-primary flex-1 flex items-center justify-center gap-2">
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
