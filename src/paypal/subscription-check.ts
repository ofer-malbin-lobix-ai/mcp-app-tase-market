import { getUserSubscription } from '../db/user-db.js';
import { getSubscription } from './paypal-service.js';

// In-memory cache: userId → boolean (has active subscription)
const subscriptionCache = new Map<string, { active: boolean; checkedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function checkSubscription(userId: string): Promise<boolean> {
  console.log(`[Subscription] Checking subscription for user: ${userId}`);

  // Check cache first
  const cached = subscriptionCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    console.log(`[Subscription] Cache hit for ${userId}: ${cached.active}`);
    return cached.active;
  }

  console.log(`[Subscription] Cache miss for ${userId}, fetching from DB...`);

  try {
    const sub = await getUserSubscription(userId);

    if (!sub) {
      console.log(`[Subscription] No subscription found for ${userId}`);
      subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
      return false;
    }

    // Check for manual (prepaid) subscription
    if (sub.manualSubscription && sub.expiresAt) {
      const expiresAt = new Date(sub.expiresAt);
      const now = new Date();
      if (expiresAt > now) {
        console.log(`[Subscription] User ${userId} has active manual subscription until ${sub.expiresAt}`);
        subscriptionCache.set(userId, { active: true, checkedAt: Date.now() });
        return true;
      } else {
        console.log(`[Subscription] Manual subscription expired for ${userId} (expired: ${sub.expiresAt})`);
        subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
        return false;
      }
    }

    // Check for free trial
    if (sub.freeTrial && sub.expiresAt) {
      const expiresAt = new Date(sub.expiresAt);
      const now = new Date();
      if (expiresAt > now) {
        console.log(`[Subscription] User ${userId} has active free trial until ${sub.expiresAt}`);
        subscriptionCache.set(userId, { active: true, checkedAt: Date.now() });
        return true;
      } else {
        console.log(`[Subscription] Free trial expired for ${userId} (expired: ${sub.expiresAt})`);
        subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
        return false;
      }
    }

    // Check if user has PayPal subscription
    if (!sub.paypalSubscriptionId) {
      console.log(`[Subscription] No subscription found for ${userId}`);
      subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
      return false;
    }

    // Check subscription status
    if (sub.subscriptionStatus !== 'active') {
      console.log(`[Subscription] Subscription status is ${sub.subscriptionStatus} for ${userId}`);
      subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
      return false;
    }

    // Optionally verify with PayPal (can be disabled for performance)
    if (process.env.VERIFY_SUBSCRIPTION_WITH_PAYPAL === 'true') {
      console.log(`[Subscription] Verifying with PayPal...`);
      try {
        const subscription = await getSubscription(sub.paypalSubscriptionId);
        const active = subscription.status === 'ACTIVE';
        console.log(`[Subscription] PayPal status: ${subscription.status}`);
        subscriptionCache.set(userId, { active, checkedAt: Date.now() });
        return active;
      } catch (error) {
        console.error(`[Subscription] PayPal verification failed:`, error);
        // Fall back to DB status
      }
    }

    console.log(`[Subscription] User ${userId} has active subscription`);
    subscriptionCache.set(userId, { active: true, checkedAt: Date.now() });
    return true;
  } catch (error) {
    console.error('[Subscription] Check failed:', error);
    return false;
  }
}

export function clearSubscriptionCache(userId?: string): void {
  if (userId) {
    subscriptionCache.delete(userId);
  } else {
    subscriptionCache.clear();
  }
}
