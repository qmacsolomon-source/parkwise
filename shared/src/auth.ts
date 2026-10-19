import { supabase, isConfigured } from './supabase';
import { Profile, UserRole } from './types';
import { PLATE_PATTERN, normalizePlate } from './plate';

export interface AuthState {
  user: any;
  profile: Profile | null;
  loading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  plate_number?: string;
  /** Four-wheeled body type, e.g. 'sedan'. Defaults to 'four_wheeled'. */
  vehicle_type?: string;
  pwd_permit_number?: string | null;
}

export const authService = {
  // Sign up new user
  async signup(credentials: SignupCredentials) {
    if (!supabase || !isConfigured) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }

    // The plate travels as sign-up metadata so the database's
    // handle_new_user() trigger can create the profile (role always
    // 'customer') and the customer's first vehicle in one transaction.
    //
    // `source: 'mobile'` is what arms that trigger: it is written to only
    // create a profile for sign-ups that come from this app, so it can never
    // interfere with the staff accounts the desktop console creates through
    // its own sign-up + profile-update flow.
    const metadata: Record<string, string> = {
      source: 'mobile',
      full_name: credentials.full_name,
      phone: credentials.phone,
    };
    if (credentials.plate_number) {
      metadata.plate_number = normalizePlate(credentials.plate_number);
      metadata.vehicle_type = credentials.vehicle_type ?? 'four_wheeled';
    }
    if (credentials.pwd_permit_number) {
      metadata.pwd_permit_number = credentials.pwd_permit_number;
    }

    const { data, error } = await supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: metadata,
        emailRedirectTo: undefined,
      },
    });

    if (error) throw error;

    // Best-effort fallback for a database where handle_new_user() has not
    // been installed yet. It already exists, is ignored on a duplicate, and
    // a failure here must never fail the sign-up itself. Same normalisation
    // as the metadata above, so both paths produce the same plate.
    const fallbackPlate = normalizePlate(credentials.plate_number);
    if (data.user && PLATE_PATTERN.test(fallbackPlate)) {
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .upsert(
          {
            owner_id: data.user.id,
            plate_number: fallbackPlate,
            vehicle_type: credentials.vehicle_type ?? 'four_wheeled',
            is_default: true,
          },
          { onConflict: 'owner_id,plate_number', ignoreDuplicates: true }
        );

      if (vehicleError && vehicleError.code !== '23505') {
        console.warn(
          'Vehicle creation is normally handled by handle_new_user(); it can be added later from My vehicles.',
          vehicleError.message
        );
      }
    }

    return data;
  },

  // Register user (alias for signup with customer-specific logic)
  async register(credentials: SignupCredentials) {
    return this.signup(credentials);
  },

  // Sign in user with audit logging
  async login(credentials: LoginCredentials) {
    if (!supabase || !isConfigured) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }
    // Log login attempt
    await this.logAudit('login_attempt', {
      email: credentials.email,
      timestamp: new Date().toISOString(),
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      // Log failed login
      await this.logAudit('login_failed', {
        email: credentials.email,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    // Log successful login
    await this.logAudit('login_success', {
      email: credentials.email,
      user_id: data.user?.id,
      timestamp: new Date().toISOString(),
    });

    return data;
  },

  // Log audit entry
  async logAudit(action: string, details: any) {
    if (!supabase || !isConfigured) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('audit_log').insert({
          actor_id: user.id,
          action,
          details,
        });
      }
    } catch (error) {
      console.error('Failed to log audit entry:', error);
    }
  },

  // Sign out user
  async logout() {
    if (!supabase || !isConfigured) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // Get current session
  async getSession() {
    if (!supabase || !isConfigured) return null;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  // Get current user
  async getCurrentUser() {
    if (!supabase || !isConfigured) return null;
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  },

  // Get user profile
  async getProfile(userId: string): Promise<Profile | null> {
    if (!supabase || !isConfigured) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Profile not found
      throw error;
    }
    return data;
  },

  // Update user profile
  async updateProfile(userId: string, updates: Partial<Profile>) {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Reset password
  async resetPassword(email: string, redirectTo?: string) {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const redirectUrl = redirectTo || '';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });
    if (error) throw error;
  },

  // Update password
  async updatePassword(newPassword: string) {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  },

  /**
   * Change the password after re-authenticating with the current one. The
   * current password is checked with a fresh sign-in, so a stolen session
   * alone cannot lock the real owner out.
   */
  async changePassword(currentPassword: string, newPassword: string) {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('You need to be signed in to change your password.');

    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthError) throw new Error('That current password is not correct.');

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  /**
   * Repair a missing profile row: ensure_my_profile() builds it from the
   * auth metadata (role always 'customer'). Returns the profile, or null
   * when the function is not installed yet.
   */
  async ensureProfile(): Promise<Profile | null> {
    if (!supabase || !isConfigured) return null;
    const { data, error } = await supabase.rpc('ensure_my_profile');
    if (error) {
      console.warn('ensure_my_profile is unavailable:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as Profile) ?? null;
  },

  /** Submit the customer's own PWD permit number; staff still verify it. */
  async submitPwdPermit(permitNumber: string): Promise<Profile | null> {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('submit_my_pwd_permit', {
      p_permit_number: permitNumber,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return (row as Profile) ?? null;
  },

  /** Ask staff to close the account; records an audit entry, deletes nothing. */
  async requestAccountDeletion(): Promise<void> {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { error } = await supabase.rpc('request_my_account_deletion');
    if (error) throw error;
  },

  // Listen to auth state changes
  onAuthStateChange(callback: (event: string, session: any) => void) {
    if (!supabase || !isConfigured) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return supabase.auth.onAuthStateChange(callback);
  },

  // Check if user has specific role
  async hasRole(userId: string, role: UserRole): Promise<boolean> {
    const profile = await this.getProfile(userId);
    return profile?.role === role;
  },

  // Get user role
  async getUserRole(userId: string): Promise<UserRole | null> {
    const profile = await this.getProfile(userId);
    return profile?.role || null;
  },
};

export default authService;
