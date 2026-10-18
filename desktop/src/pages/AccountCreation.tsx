import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '@parkwise/shared';
import {
  UserPlus, AlertTriangle, CheckCircle, LogOut,
  Eye, EyeOff, Shield, Volume2, VolumeX
} from 'lucide-react';

export default function AccountCreation() {
  const { profile, logout } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'attendant' | 'admin'>('attendant');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const isAdmin = profile?.role === 'admin';

  // Password strength calculation
  const getPasswordStrength = (pwd: string): { score: number; label: string; color: string } => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500' };
    if (score <= 4) return { score, label: 'Medium', color: 'bg-yellow-500' };
    return { score, label: 'Strong', color: 'bg-green-500' };
  };

  const passwordStrength = getPasswordStrength(password);

  const validateForm = (): boolean => {
    if (!fullName.trim()) {
      setError('Full name is required');
      return false;
    }

    if (!email.trim()) {
      setError('Email is required');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Invalid email format');
      return false;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }

    if (passwordStrength.score < 3) {
      setError('Password is too weak. Please use a stronger password.');
      return false;
    }

    return true;
  };

  const handleCreateAccount = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();

      // Check for duplicate email
      const { data: existingEmail } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase())
        .single();

      if (existingEmail) {
        setError('An account with this email already exists');
        setLoading(false);
        return;
      }

      // supabase.auth.signUp() overwrites the CURRENT client session with the
      // newly created user's session (there's no service-role key available
      // client-side to create the user without doing this). Save the admin's
      // session first so we can restore it right after, otherwise the admin
      // gets silently logged out and logged in as the account they just made.
      const { data: adminSession } = await supabase.auth.getSession();

      // Create user using Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.toLowerCase(),
        password: password,
        options: {
          data: {
            full_name: fullName,
            role: role,
            force_password_change: true,
          },
        },
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      // Restore the admin's own session before anything else. signUp() just
      // swapped the active session to the brand-new user, and the profiles
      // insert below is only allowed under RLS for an admin (or for the new
      // user acting on their own row, which there's no policy for) - so this
      // swap-back has to happen first, not after, or the insert gets
      // silently rejected.
      if (adminSession.session) {
        await supabase.auth.setSession({
          access_token: adminSession.session.access_token,
          refresh_token: adminSession.session.refresh_token,
        });
      }

      // No database trigger creates a profiles row on signup - there isn't
      // one in the live project (confirmed: pg_get_functiondef finds no
      // handle_new_user() function at all), despite comments elsewhere in
      // this codebase assuming there is. Every account created through this
      // form before this fix ended up with a real auth.users login but zero
      // matching profiles row - permanently "Access Denied" until someone
      // noticed and patched it in by hand. Insert it ourselves instead of
      // waiting on a trigger that was never actually there.
      let profileError = null;
      if (authData.user) {
        const result = await supabase
          .from('profiles')
          .upsert({
            id: authData.user.id,
            full_name: fullName,
            email: email.toLowerCase(),
            phone: '',
            role: role,
            status: 'active',
            pwd_permit_number: null,
            pwd_verified: false,
          }, { onConflict: 'id' });
        profileError = result.error;
      }

      if (profileError) {
        setError(`Login was created, but the profile failed to save: ${profileError.message}. The account won't be able to sign in until this is fixed.`);
        setLoading(false);
        return;
      }

      // Log to audit_log
      await supabase.from('audit_log').insert({
        actor_id: adminUser?.id,
        action: 'account_created',
        details: {
          new_user_id: authData.user?.id,
          email: email.toLowerCase(),
          full_name: fullName,
          role: role,
        },
      });

      // Send welcome email (using Supabase Auth's built-in email)
      // The email is automatically sent by Supabase Auth during signup

      setSuccess(true);

      // Reset form
      setFullName('');
      setEmail('');
      setRole('attendant');
      setPassword('');

      setTimeout(() => setSuccess(false), 5000);
    } catch (error: any) {
      console.error('Error creating account:', error);
      setError(error.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutModal(false);
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
            <UserPlus className="text-primary" size={24} />
            <div>
              <h1 className="text-xl font-bold text-primary">Account Creation</h1>
              <p className="text-sm text-gray-600">Create New Staff Account</p>
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

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">New Account Information</h2>

          {success && (
            <div className="mb-6 p-4 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
              <CheckCircle size={20} />
              <span className="font-semibold">Account created successfully! Welcome email sent.</span>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
              <AlertTriangle size={20} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter full name"
                className="input"
                disabled={loading}
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                className="input"
                disabled={loading}
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role <span className="text-red-500">*</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'attendant' | 'admin')}
                className="input"
                disabled={loading}
              >
                <option value="attendant">Attendant</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temporary Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter temporary password"
                  className="input pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Password Strength Meter */}
              {password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${passwordStrength.color} transition-all`}
                        style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-600">{passwordStrength.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Use at least 8 characters with uppercase, lowercase, numbers, and symbols
                  </p>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              onClick={handleCreateAccount}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating Account...
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  Create Account
                </>
              )}
            </button>
          </div>

          {/* Information */}
          <div className="mt-6 p-4 bg-blue-50 text-blue-800 rounded-lg">
            <p className="text-sm">
              <strong>Note:</strong> The user will receive a welcome email with their temporary password.
              They will be required to change their password upon first login.
            </p>
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
