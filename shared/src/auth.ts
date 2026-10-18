import { supabase, isConfigured } from './supabase';
import { Profile, UserRole } from './types';

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
  pwd_permit_number?: string | null;
}

export const authService = {
  // Sign up new user
  async signup(credentials: SignupCredentials) {
    if (!supabase || !isConfigured) {
      throw new Error('Supabase is not configured. Please check your environment variables.');
    }
    const { data, error } = await supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: {
          full_name: credentials.full_name,
          phone: credentials.phone,
        },
        emailRedirectTo: undefined,
      },
    });

    if (error) throw error;

    // There is no database trigger creating this row - checked the live
    // project directly, no handle_new_user() function exists there despite
    // this comment previously claiming otherwise. Insert it ourselves.
    // Requires the "Users can insert own profile" RLS policy (profiles,
    // auth.uid() = id AND role = 'customer') - signUp() only grants a
    // session immediately if email confirmation is off; if it's on, there's
    // no session yet to insert under, and this will need a fallback at
    // first-login time instead (not yet implemented).
    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          full_name: credentials.full_name,
          email: credentials.email.toLowerCase(),
          phone: credentials.phone,
          role: 'customer',
          status: 'active',
          pwd_permit_number: credentials.pwd_permit_number || null,
          pwd_verified: false,
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }
    }

    // Insert the customer's vehicle if plate number provided
    if (data.user && credentials.plate_number) {
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          owner_id: data.user.id,
          plate_number: credentials.plate_number.toUpperCase(),
          is_pwd: !!credentials.pwd_permit_number,
        });

      if (vehicleError) {
        console.error('Vehicle creation error:', vehicleError);
        // Don't throw - profile is created, vehicle can be added later
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
