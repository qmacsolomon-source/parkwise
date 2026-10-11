import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Support both Vite (VITE_*) and Expo (EXO_PUBLIC_*) environment variables
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) ||
                    (import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string) ||
                    '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
                        (import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) ||
                        '';

export const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'your_supabase_project_url');

export const supabase: SupabaseClient<any> | null = isConfigured
  ? createClient<any>(supabaseUrl, supabaseAnonKey)
  : null;

export default supabase;
