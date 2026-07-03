import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Public client — respects Row Level Security (use for user operations)
export const supabase = createClient(env.supabase.url, env.supabase.anonKey);

// Admin client — bypasses RLS (use ONLY for server-side privileged operations)
export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
