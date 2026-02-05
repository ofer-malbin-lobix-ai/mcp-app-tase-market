import { clerkClient } from '@clerk/express';
import type { SubscriptionMetadata } from './types.js';
import { getSubscription } from './paypal-service.js';

// In-memory cache: Clerk userId → boolean (has active subscription)
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

  console.log(`[Subscription] Cache miss for ${userId}, fetching from Clerk...`);

  try {
    const user = await clerkClient.users.getUser(userId);
    const metadata = user.publicMetadata as Partial<SubscriptionMetadata>;

    // Check if user has subscription metadata
    if (!metadata.paypal_subscription_id) {
      console.log(`[Subscription] No PayPal subscription ID found for ${userId}`);
      subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
      return false;
    }

    // Check subscription status in metadata
    if (metadata.subscription_status !== 'active') {
      console.log(`[Subscription] Subscription status is ${metadata.subscription_status} for ${userId}`);
      subscriptionCache.set(userId, { active: false, checkedAt: Date.now() });
      return false;
    }

    // Optionally verify with PayPal (can be disabled for performance)
    if (process.env.VERIFY_SUBSCRIPTION_WITH_PAYPAL === 'true') {
      console.log(`[Subscription] Verifying with PayPal...`);
      try {
        const subscription = await getSubscription(metadata.paypal_subscription_id);
        const active = subscription.status === 'ACTIVE';
        console.log(`[Subscription] PayPal status: ${subscription.status}`);
        subscriptionCache.set(userId, { active, checkedAt: Date.now() });
        return active;
      } catch (error) {
        console.error(`[Subscription] PayPal verification failed:`, error);
        // Fall back to metadata status
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
