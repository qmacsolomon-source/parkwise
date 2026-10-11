import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService, AuthState, Profile } from '@parkwise/shared';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    // Check initial session
    const initAuth = async () => {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.getProfile(session.user.id);
          setState({
            user: session.user,
            profile,
            loading: false,
          });
        } else {
          setState({
            user: null,
            profile: null,
            loading: false,
          });
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        setState({
          user: null,
          profile: null,
          loading: false,
        });
      }
    };

    initAuth();

    // Listen to auth changes
    const { data: { subscription } } = authService.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const profile = await authService.getProfile(session.user.id);
          setState({
            user: session.user,
            profile,
            loading: false,
          });
        } else {
          setState({
            user: null,
            profile: null,
            loading: false,
          });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await authService.login({ email, password });
    if (data.user) {
      const profile = await authService.getProfile(data.user.id);
      setState({
        user: data.user,
        profile,
        loading: false,
      });
    }
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
      const profile = await authService.getProfile(state.user.id);
      setState(prev => ({ ...prev, profile }));
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshProfile }}>
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
