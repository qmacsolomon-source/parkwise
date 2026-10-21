import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService, supabase, AuthState, Profile } from '@parkwise/shared';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  register: (data: {
    first_name: string;
    middle_name?: string;
    last_name: string;
    email: string;
    phone: string;
    plate_number: string;
    vehicle_type?: string;
    password: string;
    pwd_intent?: boolean;
  }) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Loads the profile and, when the row is missing, asks the database to build
 * it from the auth metadata (ensure_my_profile). A missing profile must never
 * throw here -- the UI falls back to the session email instead.
 */
async function resolveProfile(userId: string): Promise<Profile | null> {
  try {
    const profile = await authService.getProfile(userId);
    if (profile) return profile;
  } catch (error) {
    console.warn('[startup] profile fetch failed:', error);
  }

  try {
    return await authService.ensureProfile();
  } catch (error) {
    console.warn('[startup] could not repair the missing profile:', error);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const SESSION_TIMEOUT_MS = 5000;

    console.log('[startup] auth provider mounted, session check started');

    const initAuth = async () => {
      let session: Awaited<ReturnType<typeof authService.getSession>> = null;

      try {
        // Never let the session check block the UI forever.
        session = await Promise.race([
          authService.getSession(),
          new Promise<null>((resolve) =>
            setTimeout(() => {
              // Expected, non-fatal fallback - console.log instead of
              // console.warn so it doesn't pop up an on-screen LogBox.
              console.log(
                `[startup] session check timed out after ${SESSION_TIMEOUT_MS}ms, falling back to signed-out`
              );
              resolve(null);
            }, SESSION_TIMEOUT_MS)
          ),
        ]);
      } catch (error) {
        console.error('[startup] session check failed:', error);
        session = null;
      } finally {
        // Always clear the loading flag, whatever happened above.
        if (!cancelled) {
          console.log('[startup] session check finished, signedIn =', !!session?.user);
          setState({
            user: session?.user ?? null,
            profile: null,
            loading: false,
          });
        }
      }

      // Profile is fetched after loading is cleared so it can never block navigation.
      if (session?.user && !cancelled) {
        const profile = await resolveProfile(session.user.id);
        if (!cancelled) setState((prev) => ({ ...prev, profile }));
      }
    };

    initAuth();

    const { data: { subscription } } = authService.onAuthStateChange(
      // Keep this callback synchronous: awaiting Supabase inside it can deadlock auth init.
      (event, session) => {
        console.log('[startup] auth state changed:', event);

        if (!session?.user) {
          setState({ user: null, profile: null, loading: false });
          return;
        }

        setState({ user: session.user, profile: null, loading: false });

        resolveProfile(session.user.id).then((profile) =>
          setState((prev) => ({ ...prev, profile }))
        );
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Staff actions (PWD verification, etc.) happen on the desktop console, not
  // in this app, so nothing here would otherwise know to refetch - subscribe
  // directly to this user's own profile row so a change (like pwd_verified
  // flipping) reaches the app immediately, regardless of which screen is
  // open or when it was last focused.
  useEffect(() => {
    const client = supabase;
    if (!state.user?.id || !client) return;

    const channel = client
      .channel(`profile-changes-${state.user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${state.user.id}` },
        (payload: { new: Profile }) => {
          setState((prev) => ({ ...prev, profile: payload.new }));
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [state.user?.id]);

  const login = async (email: string, password: string) => {
    const data = await authService.login({ email, password });
    if (data.user) {
      const profile = await resolveProfile(data.user.id);
      setState({
        user: data.user,
        profile,
        loading: false,
      });
    }
  };

  const register = async (data: {
    first_name: string;
    middle_name?: string;
    last_name: string;
    email: string;
    phone: string;
    plate_number: string;
    vehicle_type?: string;
    password: string;
    pwd_intent?: boolean;
  }) => {
    const result = await authService.register(data);
    // signUp() always returns a user the moment the account is created, but
    // only returns a session when email confirmation is off. Without a
    // session there is no access token, so treating `user` alone as "signed
    // in" here would switch to the main app with no authenticated session -
    // every request after that (profile/vehicle creation included) would be
    // rejected by RLS. Leave state untouched and let the registration screen's
    // own "check your email" messaging handle this case instead.
    if (result.user && result.session) {
      const profile = await resolveProfile(result.user.id);
      setState({
        user: result.user,
        profile,
        loading: false,
      });
    }
  };

  const resetPassword = async (email: string) => {
    await authService.resetPassword(email);
  };

  const logout = async () => {
    await authService.logout();
    setState({
      user: null,
      profile: null,
      loading: false,
    });
  };

  const refreshProfile = async () => {
    if (state.user) {
      const profile = await resolveProfile(state.user.id);
      setState(prev => ({ ...prev, profile }));
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshProfile, register, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
