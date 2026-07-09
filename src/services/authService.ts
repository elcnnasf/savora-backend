import { supabase, supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import {
  RegisterInput, LoginInput, RefreshInput, GoogleInput,
  ForgotPasswordInput, ResetPasswordInput,
} from '../schemas/auth';

export async function register(input: RegisterInput) {
  const { name, email, password } = input;

  // Use the public signUp API so Supabase sends a real verification email
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('already') || msg.includes('duplicate')) {
      throw new AppError(409, 'An account with this email already exists');
    }
    throw new AppError(400, msg || 'Registration failed');
  }

  if (!data.user) {
    throw new AppError(400, 'Registration failed');
  }

  // When email confirmation is enabled, Supabase returns identities: [] for
  // already-registered emails (to prevent enumeration). Treat it as a conflict.
  if (data.user.identities?.length === 0) {
    throw new AppError(409, 'An account with this email already exists');
  }

  // No session yet — user must confirm their email before signing in
  return {
    email_confirmation_required: true,
    email,
  };
}

export async function login(input: LoginInput) {
  const { email, password } = input;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Don't reveal whether email exists (security best practice)
    throw new AppError(401, 'Invalid email or password');
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name, is_premium, is_pro, premium_since, member_since, cooking_skill, calorie_goal, avatar_url')
    .eq('id', data.user.id)
    .single();

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      name: profile?.name ?? '',
      avatar_url: profile?.avatar_url ?? null,
      is_premium: profile?.is_premium ?? false,
      is_pro: profile?.is_pro ?? false,
      premium_since: profile?.premium_since ?? null,
      member_since: profile?.member_since,
      cooking_skill: profile?.cooking_skill ?? 'beginner',
      calorie_goal: profile?.calorie_goal ?? 2000,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    },
  };
}

export async function refreshToken(input: RefreshInput) {
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: input.refresh_token,
  });

  if (error || !data.session) {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
  };
}

export async function googleSignIn(input: GoogleInput) {
  const { id_token } = input;

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: id_token,
  });

  if (error || !data.user || !data.session) {
    throw new AppError(401, 'Google sign in failed');
  }

  // Ensure profile exists (first-time Google users)
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', data.user.id)
    .single();

  if (!existingProfile) {
    const name = data.user.user_metadata?.full_name
      ?? data.user.user_metadata?.name
      ?? data.user.email?.split('@')[0]
      ?? 'User';

    await supabaseAdmin.from('profiles').insert({
      id: data.user.id,
      name,
      avatar_url: data.user.user_metadata?.avatar_url ?? null,
      is_premium: false,
    });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name, is_premium, is_pro, premium_since, member_since, cooking_skill, calorie_goal, avatar_url')
    .eq('id', data.user.id)
    .single();

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      name: profile?.name ?? '',
      avatar_url: profile?.avatar_url ?? null,
      is_premium: profile?.is_premium ?? false,
      is_pro: profile?.is_pro ?? false,
      premium_since: profile?.premium_since ?? null,
      member_since: profile?.member_since,
      cooking_skill: profile?.cooking_skill ?? 'beginner',
      calorie_goal: profile?.calorie_goal ?? 2000,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    },
  };
}

export async function updateSubscription(userId: string, plan: 'premium' | 'pro' | 'free') {
  const isPremium = plan === 'premium' || plan === 'pro';
  const isPro     = plan === 'pro';

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      is_premium:   isPremium,
      is_pro:       isPro,
      premium_since: isPremium ? new Date().toISOString() : null,
    })
    .eq('id', userId);

  if (error) throw new AppError(500, 'Failed to update subscription');

  return { plan, is_premium: isPremium, is_pro: isPro };
}

export async function logout(accessToken: string) {
  // Set the session then sign out to invalidate server-side
  await supabase.auth.setSession({ access_token: accessToken, refresh_token: '' });
  await supabase.auth.signOut();
}

export async function forgotPassword(input: ForgotPasswordInput) {
  // Sends the "Reset Password" email with a 6-digit OTP ({{ .Token }} in the template).
  // Always succeed from the caller's perspective — don't reveal whether the email exists.
  const { error } = await supabase.auth.resetPasswordForEmail(input.email);
  if (error && !/user.*not.*found|unable to validate/i.test(error.message)) {
    // real failures (rate limit, SMTP) should surface — silence only "no such user"
    throw new AppError(500, `Could not send reset email: ${error.message}`);
  }
}

export async function resetPassword(input: ResetPasswordInput) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: input.email,
    token: input.token,
    type: 'recovery',
  });
  if (error || !data.user) {
    throw new AppError(400, 'Invalid or expired code. Please request a new one.');
  }

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    password: input.new_password,
  });
  if (updErr) throw new AppError(500, `Could not update password: ${updErr.message}`);

  // Invalidate the temporary recovery session created by verifyOtp
  await supabase.auth.signOut().catch(() => {});
}

export async function getMe(userId: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select(`
      id, name, avatar_url, is_premium, is_pro, premium_since,
      member_since, cooking_skill, calorie_goal,
      user_preferences (
        dietary_restrictions, cuisine_preferences,
        disliked_ingredients, max_cook_time
      )
    `)
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new AppError(404, 'Profile not found');
  }

  // Get today's AI usage
  const today = new Date().toISOString().split('T')[0];
  const { data: usage } = await supabaseAdmin
    .from('ai_usage')
    .select('recipes_count, meal_plans_count, scans_count, suggestions_count, ai_chat_count')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  return {
    ...profile,
    ai_usage_today: usage ?? {
      recipes_count: 0,
      meal_plans_count: 0,
      scans_count: 0,
      suggestions_count: 0,
      ai_chat_count: 0,
    },
  };
}

/** Update editable profile fields (display name, preset avatar id). */
export async function updateProfile(
  userId: string,
  patch: { name?: string; avatar_url?: string | null },
) {
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.name       !== undefined) update.name       = patch.name;
  if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .select('id, name, avatar_url, is_premium, is_pro, member_since')
    .single();
  if (error || !data) throw new AppError(500, error?.message ?? 'Could not update profile');
  return data;
}

/** Permanently delete the account. Cascades to all owned rows via FK ON DELETE CASCADE. */
export async function deleteAccount(userId: string) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new AppError(500, `Could not delete account: ${error.message}`);
}

// ─── Taste preferences sync ─────────────────────────────────────────────────
// Stores the full Taste Preferences wizard answers per account so they follow
// the user across devices and reinstalls (requires the taste_prefs migration).

export async function getTastePrefs(userId: string): Promise<unknown | null> {
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('taste_prefs')
    .eq('user_id', userId)
    .maybeSingle();

  // Missing column (migration not run yet) or no row — behave as "nothing saved"
  if (error) return null;
  return data?.taste_prefs ?? null;
}

export async function saveTastePrefs(userId: string, prefs: unknown): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_preferences')
    .upsert(
      { user_id: userId, taste_prefs: prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  if (error) throw new AppError(500, error.message);
}
