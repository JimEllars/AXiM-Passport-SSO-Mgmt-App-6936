import { createClient } from '@supabase/supabase-js';

// Configuration for Phase 2 Supabase Core API integration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseClient = null;

if (supabaseUrl && supabaseAnonKey) {
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Phase 2 Supabase Core Google OAuth handoff.
 */
export async function signInWithGoogle(redirectUrl, turnstileToken) {
  if (!supabaseClient) {
    throw new Error('Supabase Core API is not configured.');
  }

  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      queryParams: {
        turnstileToken: turnstileToken || '',
      }
    }
  });

  if (error) {
    console.error('Supabase OAuth Error:', error);
    throw error;
  }

  return data;
}

export function getCoreApiStatus() {
  return {
    ready: Boolean(supabaseClient),
  };
}
