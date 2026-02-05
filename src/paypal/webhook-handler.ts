import { clerkClient } from '@clerk/express';
import type { PayPalWebhookEvent, SubscriptionMetadata } from './types.js';
import { getSubscription, getPlanTypeFromPlanId, verifyWebhookSignature } from './paypal-service.js';
import { clearSubscriptionCache } from './subscription-check.js';

export async function handleWebhook(
  headers: Record<string, string>,
  rawBody: string,
): Promise<{ success: boolean; message: string }> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    console.error('PAYPAL_WEBHOOK_ID not configured');
    return { success: false, message: 'Webhook not configured' };
  }

  const isValid = await verifyWebhookSignature(webhookId, headers, rawBody);
  if (!isValid) {
    console.error('Invalid webhook signature');
    return { success: false, message: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as PayPalWebhookEvent;
  console.log(`Processing PayPal webhook: ${event.event_type}`);

  const userId = event.resource.custom_id;
  if (!userId) {
    console.error('No custom_id (userId) in webhook payload');
    return { success: false, message: 'Missing user ID' };
  }

  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
      await handleSubscriptionActivated(userId, event);
      break;

    case 'BILLING.SUBSCRIPTION.CANCELLED':
      await handleSubscriptionCancelled(userId, event);
      break;

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      await handleSubscriptionSuspended(userId, event);
      break;

    case 'BILLING.SUBSCRIPTION.EXPIRED':
      await handleSubscriptionExpired(userId, event);
      break;

    case 'PAYMENT.SALE.COMPLETED':
      await handlePaymentCompleted(userId, event);
      break;

    default:
      console.log(`Unhandled webhook event type: ${event.event_type}`);
  }

  return { success: true, message: 'Webhook processed' };
}

async function handleSubscriptionActivated(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const subscription = await getSubscription(event.resource.id);
  const planType = getPlanTypeFromPlanId(subscription.plan_id);

  if (!planType) {
    console.error(`Unknown plan ID: ${subscription.plan_id}`);
    return;
  }

  const expiresAt = subscription.billing_info?.next_billing_time
    ? new Date(subscription.billing_info.next_billing_time).toISOString().split('T')[0]
    : calculateExpiryDate(planType);

  const metadata: SubscriptionMetadata = {
    plan: planType,
    paypal_subscription_id: subscription.id,
    subscription_status: 'active',
    expires_at: expiresAt,
  };

  await updateUserMetadata(userId, metadata);
  console.log(`Subscription activated for user ${userId}: ${planType}`);
}

async function handleSubscriptionCancelled(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const user = await clerkClient.users.getUser(userId);
  const currentMetadata = user.publicMetadata as Partial<SubscriptionMetadata>;

  if (currentMetadata.paypal_subscription_id !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  const metadata: SubscriptionMetadata = {
    plan: currentMetadata.plan ?? 'monthly',
    paypal_subscription_id: event.resource.id,
    subscription_status: 'cancelled',
    expires_at: currentMetadata.expires_at ?? new Date().toISOString().split('T')[0],
  };

  await updateUserMetadata(userId, metadata);
  console.log(`Subscription cancelled for user ${userId}`);
}

async function handleSubscriptionSuspended(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const user = await clerkClient.users.getUser(userId);
  const currentMetadata = user.publicMetadata as Partial<SubscriptionMetadata>;

  if (currentMetadata.paypal_subscription_id !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  const metadata: SubscriptionMetadata = {
    plan: currentMetadata.plan ?? 'monthly',
    paypal_subscription_id: event.resource.id,
    subscription_status: 'suspended',
    expires_at: currentMetadata.expires_at ?? new Date().toISOString().split('T')[0],
  };

  await updateUserMetadata(userId, metadata);
  console.log(`Subscription suspended for user ${userId}`);
}

async function handleSubscriptionExpired(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const user = await clerkClient.users.getUser(userId);
  const currentMetadata = user.publicMetadata as Partial<SubscriptionMetadata>;

  if (currentMetadata.paypal_subscription_id !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  const metadata: SubscriptionMetadata = {
    plan: currentMetadata.plan ?? 'monthly',
    paypal_subscription_id: event.resource.id,
    subscription_status: 'expired',
    expires_at: new Date().toISOString().split('T')[0],
  };

  await updateUserMetadata(userId, metadata);
  console.log(`Subscription expired for user ${userId}`);
}

async function handlePaymentCompleted(
  userId: string,
  _event: PayPalWebhookEvent,
): Promise<void> {
  const user = await clerkClient.users.getUser(userId);
  const currentMetadata = user.publicMetadata as Partial<SubscriptionMetadata>;

  if (!currentMetadata.paypal_subscription_id || !currentMetadata.plan) {
    console.log('User has no active subscription');
    return;
  }

  const subscription = await getSubscription(currentMetadata.paypal_subscription_id);

  const expiresAt = subscription.billing_info?.next_billing_time
    ? new Date(subscription.billing_info.next_billing_time).toISOString().split('T')[0]
    : calculateExpiryDate(currentMetadata.plan);

  const metadata: SubscriptionMetadata = {
    plan: currentMetadata.plan,
    paypal_subscription_id: currentMetadata.paypal_subscription_id,
    subscription_status: 'active',
    expires_at: expiresAt,
  };

  await updateUserMetadata(userId, metadata);
  console.log(`Payment completed for user ${userId}, expires: ${expiresAt}`);
}

async function updateUserMetadata(
  userId: string,
  metadata: SubscriptionMetadata,
): Promise<void> {
  await clerkClient.users.updateUser(userId, {
    publicMetadata: metadata,
  });
  // Clear subscription cache so next check gets fresh data
  clearSubscriptionCache(userId);
}

function calculateExpiryDate(planType: 'monthly' | 'yearly'): string {
  const date = new Date();
  if (planType === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date.toISOString().split('T')[0];
}
