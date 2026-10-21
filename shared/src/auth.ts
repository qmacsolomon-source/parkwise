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
  first_name: string;
  middle_name?: string;
  last_name: string;
  phone: string;
  plate_number?: string;
  /** Four-wheeled body type, e.g. 'sedan'. Defaults to 'four_wheeled'. */
  vehicle_type?: string;
  /**
   * True when the customer checked "I have a PWD permit" at sign-up. This is
   * intent only, not verification - the actual permit number and photo are
   * completed afterward in Settings (authService.submitPwdPermit).
   */
  pwd_intent?: boolean;
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
    const fullName = [credentials.first_name, credentials.middle_name, credentials.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ');

    const metadata: Record<string, string | boolean> = {
      source: 'mobile',
      first_name: credentials.first_name.trim(),
      last_name: credentials.last_name.trim(),
      full_name: fullName,
      phone: credentials.phone,
    };
    if (credentials.middle_name?.trim()) {
      metadata.middle_name = credentials.middle_name.trim();
    }
    if (credentials.plate_number) {
      metadata.plate_number = normalizePlate(credentials.plate_number);
      metadata.vehicle_type = credentials.vehicle_type ?? 'four_wheeled';
    }
    if (credentials.pwd_intent) {
      metadata.pwd_intent = true;
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

    // Best-effort fallback for a database where handle_new_user() isn't
    // installed (or for a race where it somehow hasn't run yet) - upserts,
    // not inserts, so this is a harmless no-op once the trigger has already
    // created both rows. Gated on an actual session existing: this needs
    // the signed-up user's own JWT to pass RLS (auth.uid() = id), and
    // signUp() only grants a session immediately when email confirmation is
    // off. When confirmation is required there's no session yet, so this
    // would always fail with a 42501 - skip it rather than log a confusing
    // error for something the trigger already handles unconditionally
    // server-side (it runs on auth.users insert, with no session needed).
    if (data.user && data.session) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          full_name: fullName,
          first_name: credentials.first_name.trim(),
          middle_name: credentials.middle_name?.trim() || null,
          last_name: credentials.last_name.trim(),
          email: credentials.email.toLowerCase(),
          phone: credentials.phone,
          role: 'customer',
          status: 'active',
          pwd_intent: !!credentials.pwd_intent,
          pwd_verified: false,
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }
    }

    // Same normalisation as the metadata above, so both paths produce the
    // same plate. Same session gate as the profile fallback above, and for
    // the same reason.
    const fallbackPlate = normalizePlate(credentials.plate_number);
    if (data.user && data.session && PLATE_PATTERN.test(fallbackPlate)) {
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

    // The login field accepts an email OR an 11-digit phone number - Supabase
    // itself only signs in by email, so a phone-shaped identifier is first
    // resolved to the matching email via email_for_phone(). If nothing
    // matches, the original (phone-shaped) value is left in place so
    // signInWithPassword below fails with the same generic "invalid
    // credentials" error as a wrong password - never revealing whether that
    // phone number exists.
    let email = credentials.email;
    const looksLikePhone = !email.includes('@') && /^\d{11}$/.test(email.replace(/\D/g, ''));
    if (looksLikePhone) {
      const { data: resolvedEmail } = await supabase.rpc('email_for_phone', {
        p_phone: email,
      });
      if (resolvedEmail) email = resolvedEmail as string;
    }

    // Log login attempt
    await this.logAudit('login_attempt', {
      email: credentials.email,
      timestamp: new Date().toISOString(),
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
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

  // Reset password. Without an explicit redirectTo, this falls back to the
  // project's Site URL - which is the "you're verified" sign-up confirmation
  // page, not anywhere a customer can actually type a new password. Reads
  // EXPO_PUBLIC_RESET_PASSWORD_URL (web/reset-password.html, once deployed)
  // so the two flows land on their own correct pages.
  async resetPassword(email: string, redirectTo?: string) {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const redirectUrl = redirectTo || process.env.EXPO_PUBLIC_RESET_PASSWORD_URL || undefined;
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

  /**
   * Submit the customer's own PWD permit number and, optionally, the storage
   * path of a photo of the permit (see uploadMyPwdPermitPhoto in
   * pwdPermitPhotos.ts). Staff still verify it - this never sets
   * pwd_verified.
   */
  async submitPwdPermit(permitNumber: string, photoPath?: string | null): Promise<Profile | null> {
    if (!supabase || !isConfigured) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('submit_my_pwd_permit', {
      p_permit_number: permitNumber,
      p_photo_path: photoPath ?? null,
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
