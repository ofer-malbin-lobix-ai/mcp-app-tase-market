import { getUserSubscription, upsertSubscription } from '../db/user-db.js';
import type { PayPalWebhookEvent } from './types.js';
import { getSubscription, getPlanTypeFromPlanId, verifyWebhookSignature } from './paypal-service.js';
import { addAppSubscription, removeAppSubscription } from '../auth0/auth0-management.js';

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

  await upsertSubscription(userId, {
    plan: planType,
    paypalSubscriptionId: subscription.id,
    subscriptionStatus: 'active',
    expiresAt,
  });


  // Grant app access in Auth0 with expiry
  try {
    await addAppSubscription(userId, 'tase-market', expiresAt);
  } catch (error) {
    console.error(`Failed to add app for user ${userId}:`, error);
  }

  console.log(`Subscription activated for user ${userId}: ${planType}`);
}

async function handleSubscriptionCancelled(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const sub = await getUserSubscription(userId);

  if (sub?.paypalSubscriptionId !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  await upsertSubscription(userId, {
    plan: sub.plan ?? 'monthly',
    paypalSubscriptionId: event.resource.id,
    subscriptionStatus: 'cancelled',
    expiresAt: sub.expiresAt ?? new Date().toISOString().split('T')[0],
  });


  // Revoke app access in Auth0
  try {
    await removeAppSubscription(userId, 'tase-market');
  } catch (error) {
    console.error(`Failed to remove app for user ${userId}:`, error);
  }

  console.log(`Subscription cancelled for user ${userId}`);
}

async function handleSubscriptionSuspended(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const sub = await getUserSubscription(userId);

  if (sub?.paypalSubscriptionId !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  await upsertSubscription(userId, {
    plan: sub.plan ?? 'monthly',
    paypalSubscriptionId: event.resource.id,
    subscriptionStatus: 'suspended',
    expiresAt: sub.expiresAt ?? new Date().toISOString().split('T')[0],
  });


  try {
    await removeAppSubscription(userId, 'tase-market');
  } catch (error) {
    console.error(`Failed to remove app for user ${userId}:`, error);
  }

  console.log(`Subscription suspended for user ${userId}`);
}

async function handleSubscriptionExpired(
  userId: string,
  event: PayPalWebhookEvent,
): Promise<void> {
  const sub = await getUserSubscription(userId);

  if (sub?.paypalSubscriptionId !== event.resource.id) {
    console.log('Webhook subscription ID does not match user subscription');
    return;
  }

  await upsertSubscription(userId, {
    plan: sub.plan ?? 'monthly',
    paypalSubscriptionId: event.resource.id,
    subscriptionStatus: 'expired',
    expiresAt: new Date().toISOString().split('T')[0],
  });


  try {
    await removeAppSubscription(userId, 'tase-market');
  } catch (error) {
    console.error(`Failed to remove app for user ${userId}:`, error);
  }

  console.log(`Subscription expired for user ${userId}`);
}

async function handlePaymentCompleted(
  userId: string,
  _event: PayPalWebhookEvent,
): Promise<void> {
  const sub = await getUserSubscription(userId);

  if (!sub?.paypalSubscriptionId || !sub?.plan) {
    console.log('User has no active subscription');
    return;
  }

  const subscription = await getSubscription(sub.paypalSubscriptionId);

  const expiresAt = subscription.billing_info?.next_billing_time
    ? new Date(subscription.billing_info.next_billing_time).toISOString().split('T')[0]
    : calculateExpiryDate(sub.plan as 'monthly' | 'yearly');

  await upsertSubscription(userId, {
    plan: sub.plan,
    paypalSubscriptionId: sub.paypalSubscriptionId,
    subscriptionStatus: 'active',
    expiresAt,
  });

  // Update app access expiry in Auth0
  try {
    await addAppSubscription(userId, 'tase-market', expiresAt);
  } catch (error) {
    console.error(`Failed to update app expiry for user ${userId}:`, error);
  }

  console.log(`Payment completed for user ${userId}, expires: ${expiresAt}`);
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
