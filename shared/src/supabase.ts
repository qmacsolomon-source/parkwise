import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Support both Vite (VITE_*) and Expo (EXPO_PUBLIC_*) environment variables
// Use type-safe access to avoid Metro build errors
const getEnvVar = (viteKey: string, expoKey: string): string => {
  // Try Vite (import.meta.env) - safe check for browser
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const viteValue = (import.meta.env as any)[viteKey];
    if (viteValue) return viteValue;
  }

  // Try Expo (process.env) - safe check for React Native
  if (typeof process !== 'undefined' && process.env) {
    const expoValue = process.env[expoKey];
    if (expoValue) return expoValue;
  }

  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

export const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'your_supabase_project_url');

// Check if we're in React Native environment (not browser)
const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

// Dynamically load AsyncStorage only in React Native
// This prevents Vite from trying to bundle the React Native package
// Use a fully dynamic string require to bypass Vite's static analysis
const getStorageAdapter = () => {
  if (!isReactNative) return undefined;

  try {
    // Use dynamic require with string concatenation to avoid Vite bundling
    const pkgName = '@react-native-async-storage/async-storage';
    const AsyncStorage = require(pkgName).default;
    return {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    };
  } catch (e) {
    return undefined;
  }
};

export const supabase: SupabaseClient<any> | null = isConfigured
  ? createClient<any>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: getStorageAdapter(),
      },
    })
  : null;

export default supabase;
