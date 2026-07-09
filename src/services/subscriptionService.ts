/**
 * RevenueCat-backed subscription state.
 *
 * The RevenueCat REST API is the source of truth for what a user actually
 * paid for. Both the post-purchase sync (/auth/subscribe) and the webhook
 * re-fetch the subscriber and mirror the active entitlements into
 * profiles.is_premium / is_pro — event payloads alone are never trusted,
 * which also makes out-of-order webhook delivery harmless.
 *
 * Entitlement identifiers expected in RevenueCat: "premium" and "pro".
 */
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';

export type Plan = 'free' | 'premium' | 'pro';

interface EntitlementState {
  premium: boolean;
  pro: boolean;
}

export function isRevenueCatEnabled(): boolean {
  return env.revenuecat.secretKey.length > 0;
}

async function fetchEntitlements(appUserId: string): Promise<EntitlementState> {
  const res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${env.revenuecat.secretKey}` } },
  );
  if (!res.ok) {
    throw new AppError(502, `RevenueCat lookup failed (${res.status})`);
  }
  const json: any = await res.json();
  const entitlements = json?.subscriber?.entitlements ?? {};

  const isActive = (key: string): boolean => {
    const e = entitlements[key];
    if (!e) return false;
    // expires_date null → lifetime; otherwise must be in the future
    return e.expires_date == null || new Date(e.expires_date).getTime() > Date.now();
  };

  return { premium: isActive('premium'), pro: isActive('pro') };
}

async function applyPlan(userId: string, state: EntitlementState) {
  const isPro     = state.pro;
  const isPremium = state.premium || state.pro;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      is_premium:    isPremium,
      is_pro:        isPro,
      premium_since: isPremium ? new Date().toISOString() : null,
    })
    .eq('id', userId);

  if (error) throw new AppError(500, 'Failed to update subscription');

  const plan: Plan = isPro ? 'pro' : isPremium ? 'premium' : 'free';
  return { plan, is_premium: isPremium, is_pro: isPro };
}

/** Verify with RevenueCat and mirror the result into the user's profile. */
export async function syncSubscription(userId: string) {
  const state = await fetchEntitlements(userId);
  return applyPlan(userId, state);
}
