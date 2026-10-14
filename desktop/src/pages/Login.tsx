import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, AlertCircle, Eye, EyeOff, Car } from 'lucide-react';
import { supabase } from '@parkwise/shared';
import { useNavigate } from 'react-router-dom';

const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

interface LockoutState {
  isLocked: boolean;
  attempts: number;
  lockUntil: number | null;
}

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState<LockoutState>({ isLocked: false, attempts: 0, lockUntil: null });
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);

  // Load lockout state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('login_lockout');
    if (stored) {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      if (parsed.lockUntil && parsed.lockUntil > now) {
        setLockout(parsed);
      } else {
        localStorage.removeItem('login_lockout');
      }
    }
  }, []);

  const updateLockout = (attempts: number, isLocked: boolean = false) => {
    const newState: LockoutState = {
      isLocked,
      attempts,
      lockUntil: isLocked ? Date.now() + LOCKOUT_DURATION : null,
    };
    setLockout(newState);
    if (isLocked) {
      localStorage.setItem('login_lockout', JSON.stringify(newState));
    } else if (attempts === 0) {
      localStorage.removeItem('login_lockout');
    } else {
      localStorage.setItem('login_lockout', JSON.stringify(newState));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate fields
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    // Check lockout
    if (lockout.isLocked) {
      const now = Date.now();
      if (lockout.lockUntil && lockout.lockUntil > now) {
        const remaining = Math.ceil((lockout.lockUntil - now) / 1000 / 60);
        setError(`Account locked. Try again in ${remaining} minutes.`);
        return;
      } else {
        // Lockout expired
        updateLockout(0, false);
      }
    }

    setLoading(true);

    try {
      await login(email, password);
      // Successful login - reset attempts
      updateLockout(0, false);

      navigate('/dashboard');
    } catch (err: any) {
      const newAttempts = lockout.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        updateLockout(newAttempts, true);
        setError('Too many failed attempts. Account locked for 15 minutes.');
      } else {
        updateLockout(newAttempts, false);
        setError('Incorrect email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail || !resetEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    if (!supabase) {
      setError('Supabase is not configured. Please check your environment variables.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetEmailSent(true);
      setError('');
    } catch (err: any) {
      setError('Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getRemainingTime = () => {
    if (!lockout.lockUntil) return 0;
    const now = Date.now();
    if (lockout.lockUntil <= now) return 0;
    return Math.ceil((lockout.lockUntil - now) / 1000);
  };

  if (showResetForm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="card max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary mb-2">Reset Password</h1>
            <p className="text-gray-600">Enter your email to receive a reset link</p>
          </div>

          {resetEmailSent ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-green-600" size={32} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Email Sent</h3>
              <p className="text-gray-600 mb-6">
                Check your email for the password reset link.
              </p>
              <button
                onClick={() => {
                  setShowResetForm(false);
                  setResetEmailSent(false);
                  setResetEmail('');
                }}
                className="btn-primary w-full"
              >
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-800 rounded-lg">
                  <AlertCircle size={16} />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="input"
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center gap-2"
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowResetForm(false);
                  setResetEmail('');
                  setError('');
                }}
                className="btn-secondary w-full"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left Panel - Branded Gradient */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary-dark to-accent items-center justify-center p-12">
        <div className="text-center text-white">
          <div className="mb-8">
            <Car size={80} className="mx-auto mb-4" />
            <h1 className="text-5xl font-bold mb-4">ParkWise</h1>
            <p className="text-xl opacity-90">Intelligent Parking Management</p>
          </div>
          <div className="space-y-4 text-left max-w-md mx-auto">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-accent rounded-full mt-2" />
              <p className="opacity-80">Real-time slot monitoring</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-accent rounded-full mt-2" />
              <p className="opacity-80">Automated license plate verification</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-accent rounded-full mt-2" />
              <p className="opacity-80">Seamless reservation management</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="card max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary mb-2">Welcome Back</h1>
            <p className="text-gray-600">Sign in to the Attendant Console</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-800 rounded-lg" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="attendant@gmail.com"
                required
                disabled={loading || lockout.isLocked}
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="••••••••"
                  required
                  disabled={loading || lockout.isLocked}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                {lockout.attempts > 0 && !lockout.isLocked && (
                  <span className="text-amber-600">
                    {MAX_ATTEMPTS - lockout.attempts} attempts remaining
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowResetForm(true);
                  setError('');
                }}
                className="text-sm text-accent hover:text-accent-dark focus:outline-none focus:underline"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={loading || lockout.isLocked}
            >
              <LogIn size={18} />
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600 border-t pt-4">
            <p className="font-medium">For attendants and admins only</p>
            <p className="mt-1">Customers should use the mobile app</p>
          </div>
        </div>
      </div>
    </div>
  );
}
