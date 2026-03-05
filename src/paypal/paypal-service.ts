import type {
  PayPalTokenResponse,
  PayPalSubscription,
  PlanConfig,
} from './types.js';

const PAYPAL_API_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Token cache
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export const PLANS: Record<'monthly' | 'yearly', PlanConfig> = {
  monthly: {
    id: 'monthly',
    name: 'Monthly Plan',
    price: 35,
    currency: 'ILS',
    interval: 'MONTH',
    planId: process.env.PAYPAL_PLAN_MONTHLY ?? '',
  },
  yearly: {
    id: 'yearly',
    name: 'Yearly Plan',
    price: 350,
    currency: 'ILS',
    interval: 'YEAR',
    planId: process.env.PAYPAL_PLAN_YEARLY ?? '',
  },
};

async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && tokenExpiresAt > now) {
    return cachedToken;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal auth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as PayPalTokenResponse;

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in - 60) * 1000;

  return data.access_token;
}

export async function createSubscription(
  planType: 'monthly' | 'yearly',
  userId: string,
): Promise<{ approvalUrl: string; subscriptionId: string }> {
  const token = await getAccessToken();
  const plan = PLANS[planType];

  if (!plan.planId) {
    throw new Error(`PayPal plan ID not configured for ${planType}`);
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:3001';

  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      plan_id: plan.planId,
      custom_id: userId,
      application_context: {
        brand_name: 'TASE Data Hub',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: `${appUrl}/api/paypal/success`,
        cancel_url: `${appUrl}/api/paypal/cancel`,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal subscription creation failed: ${response.status} ${errorText}`);
  }

  const subscription = await response.json() as PayPalSubscription;

  const approvalLink = subscription.links.find((link) => link.rel === 'approve');
  if (!approvalLink) {
    throw new Error('No approval URL in PayPal response');
  }

  return {
    approvalUrl: approvalLink.href,
    subscriptionId: subscription.id,
  };
}

export async function getSubscription(subscriptionId: string): Promise<PayPalSubscription> {
  const token = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal get subscription failed: ${response.status} ${errorText}`);
  }

  return await response.json() as PayPalSubscription;
}

export async function cancelSubscription(subscriptionId: string, reason?: string): Promise<void> {
  const token = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: reason ?? 'User requested cancellation',
    }),
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(`PayPal cancel subscription failed: ${response.status} ${errorText}`);
  }
}

export async function verifyWebhookSignature(
  webhookId: string,
  headers: Record<string, string>,
  body: string,
): Promise<boolean> {
  const token = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(body),
    }),
  });

  if (!response.ok) {
    console.error('Webhook verification request failed:', response.status);
    return false;
  }

  const result = await response.json() as { verification_status: string };
  return result.verification_status === 'SUCCESS';
}

export function getPlanTypeFromPlanId(planId: string): 'monthly' | 'yearly' | null {
  if (planId === PLANS.monthly.planId) return 'monthly';
  if (planId === PLANS.yearly.planId) return 'yearly';
  return null;
}
