import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSubscription,
  getSubscription,
  cancelSubscription,
  PLANS,
  getPlanTypeFromPlanId,
} from './paypal-service.js';
import { handleWebhook } from './webhook-handler.js';
import { verifySubscribeToken } from './subscribe-token.js';
import { getUserSubscription, upsertSubscription } from '../db/user-db.js';
import type { CreateSubscriptionRequest } from './types.js';

// Helper to get userId from token
function resolveUserId(req: Request): string | null {
  const token = (req.query.token as string) || (req.body as { token?: string })?.token;
  if (token) {
    const userId = verifySubscribeToken(token);
    if (userId) return userId;
  }
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve HTML files path - works from both src/ and dist/
const HTML_DIR = __filename.includes('/dist/')
  ? path.join(__dirname, '..', '..', '..', 'src', 'paypal')  // from dist/src/paypal/ to src/paypal/
  : __dirname;  // from src/paypal/

export function createSubscriptionRouter(): Router {
  const router = Router();

  // Serve subscription page (accepts token)
  router.get('/subscribe', async (req: Request, res: Response) => {
    const userId = resolveUserId(req);

    try {
      const htmlPath = path.join(HTML_DIR, 'subscribe.html');
      let html = await fs.readFile(htmlPath, 'utf-8');

      if (!userId) {
        // No valid token — serve page without status
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
        return;
      }

      // Inject token into the page so it can be used for API calls
      const token = req.query.token as string;
      if (token) {
        html = html.replace('</head>', `<script>window.SUBSCRIBE_TOKEN = "${token}";</script></head>`);
      }

      // Inject subscription status server-side so the page doesn't need a separate fetch
      try {
        const sub = await getUserSubscription(userId);
        const isManualActive = !!sub?.manualSubscription && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date();
        const isFreeTrialActive = !!sub?.freeTrial && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date();
        const status = {
          hasSubscription: !!sub?.paypalSubscriptionId || isManualActive || isFreeTrialActive,
          plan: sub?.plan ?? (isManualActive ? 'manual' : isFreeTrialActive ? 'trial' : null),
          status: (isManualActive || isFreeTrialActive) ? 'active' : (sub?.subscriptionStatus ?? null),
          expiresAt: sub?.expiresAt ?? null,
          isManual: isManualActive,
          isFreeTrial: isFreeTrialActive,
          freeTrialUsed: !!sub?.freeTrialUsed,
          plans: {
            monthly: { price: PLANS.monthly.price, name: PLANS.monthly.name },
            yearly: { price: PLANS.yearly.price, name: PLANS.yearly.name },
          },
        };
        html = html.replace('</head>', `<script>window.INJECTED_STATUS = ${JSON.stringify(status)};</script></head>`);
      } catch (e) {
        console.error('Error fetching user status for injection:', e);
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving subscribe page:', error);
      res.status(500).send('Error loading subscription page');
    }
  });

  // Get subscription status (accepts token)
  router.get('/api/subscription/status', async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const sub = await getUserSubscription(userId);
      const isManualActive = !!sub?.manualSubscription && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date();
      const isFreeTrialActive = !!sub?.freeTrial && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date();

      res.json({
        hasSubscription: !!sub?.paypalSubscriptionId || isManualActive || isFreeTrialActive,
        plan: sub?.plan ?? (isManualActive ? 'manual' : isFreeTrialActive ? 'trial' : null),
        status: (isManualActive || isFreeTrialActive) ? 'active' : (sub?.subscriptionStatus ?? null),
        expiresAt: sub?.expiresAt ?? null,
        isManual: isManualActive,
        isFreeTrial: isFreeTrialActive,
        freeTrialUsed: !!sub?.freeTrialUsed,
        plans: {
          monthly: { price: PLANS.monthly.price, name: PLANS.monthly.name },
          yearly: { price: PLANS.yearly.price, name: PLANS.yearly.name },
        },
      });
    } catch (error) {
      console.error('Error getting subscription status:', error);
      res.status(500).json({ error: 'Failed to get subscription status' });
    }
  });

  // Create subscription (accepts token)
  router.post('/api/paypal/create-subscription', async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - invalid or expired token' });
        return;
      }

      const { planType } = req.body as CreateSubscriptionRequest;

      if (!planType || !['monthly', 'yearly'].includes(planType)) {
        res.status(400).json({ error: 'Invalid plan type' });
        return;
      }

      const sub = await getUserSubscription(userId);

      if (sub?.subscriptionStatus === 'active') {
        res.status(400).json({ error: 'User already has an active subscription' });
        return;
      }

      const result = await createSubscription(planType, userId);
      res.json(result);
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  });

  // Start free trial (accepts token)
  router.post('/api/paypal/start-free-trial', async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - invalid or expired token' });
        return;
      }

      const sub = await getUserSubscription(userId);

      // Check if free trial already used
      if (sub?.freeTrialUsed) {
        res.status(400).json({ error: 'Free trial has already been used' });
        return;
      }

      // Check if user already has an active subscription
      const isManualActive = !!sub?.manualSubscription && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date();
      const hasActiveSubscription = sub?.subscriptionStatus === 'active' || isManualActive;
      if (hasActiveSubscription) {
        res.status(400).json({ error: 'User already has an active subscription' });
        return;
      }

      // Set free trial: 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const expiresAtStr = expiresAt.toISOString().split('T')[0];

      await upsertSubscription(userId, {
        freeTrial: true,
        freeTrialUsed: true,
        expiresAt: expiresAtStr,
      });



      console.log(`[Subscription] Free trial activated for user ${userId} until ${expiresAtStr}`);
      res.json({ success: true, expiresAt: expiresAtStr });
    } catch (error) {
      console.error('Error starting free trial:', error);
      res.status(500).json({ error: 'Failed to start free trial' });
    }
  });

  // PayPal success callback (PUBLIC - no auth required)
  // Uses custom_id from PayPal subscription to identify the user
  router.get('/api/paypal/success', async (req: Request, res: Response) => {
    try {
      const subscriptionId = req.query.subscription_id as string;
      if (!subscriptionId) {
        res.redirect('/paypal/result?error=missing_subscription');
        return;
      }

      const subscription = await getSubscription(subscriptionId);

      // Get userId from PayPal's custom_id field
      const userId = subscription.custom_id;
      if (!userId) {
        console.error('No custom_id (userId) in PayPal subscription');
        res.redirect('/paypal/result?error=missing_user');
        return;
      }

      if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
        res.redirect(`/paypal/result?error=subscription_not_active&status=${subscription.status}`);
        return;
      }

      const planType = getPlanTypeFromPlanId(subscription.plan_id);
      if (!planType) {
        res.redirect('/paypal/result?error=unknown_plan');
        return;
      }

      const expiresAt = subscription.billing_info?.next_billing_time
        ? new Date(subscription.billing_info.next_billing_time).toISOString().split('T')[0]
        : calculateExpiryDate(planType);

      await upsertSubscription(userId, {
        plan: planType,
        paypalSubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        expiresAt,
      });



      res.redirect(`/paypal/result?success=true&plan=${planType}`);
    } catch (error) {
      console.error('Error handling PayPal success:', error);
      res.redirect('/paypal/result?error=callback_failed');
    }
  });

  // PayPal cancel callback (PUBLIC - no auth required)
  router.get('/api/paypal/cancel', async (_req: Request, res: Response) => {
    res.redirect('/paypal/result?cancelled=true');
  });

  // PayPal result page (PUBLIC - shows success/cancel/error messages)
  router.get('/paypal/result', async (_req: Request, res: Response) => {
    try {
      const htmlPath = path.join(HTML_DIR, 'paypal-result.html');
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving PayPal result page:', error);
      res.status(500).send('Error loading page');
    }
  });

  // Cancel subscription (token-based auth)
  router.post('/api/paypal/cancel-subscription', async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const sub = await getUserSubscription(userId);

      if (!sub?.paypalSubscriptionId) {
        res.status(400).json({ error: 'No active subscription found' });
        return;
      }

      await cancelSubscription(sub.paypalSubscriptionId);

      await upsertSubscription(userId, {
        plan: sub.plan ?? 'monthly',
        paypalSubscriptionId: sub.paypalSubscriptionId,
        subscriptionStatus: 'cancelled',
        expiresAt: sub.expiresAt ?? new Date().toISOString().split('T')[0],
      });

      res.json({ success: true, message: 'Subscription cancelled' });
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  });

  // PayPal webhook
  router.post('/api/paypal/webhook', async (req: Request, res: Response) => {
    try {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key.toLowerCase()] = value;
        }
      }

      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      const result = await handleWebhook(headers, rawBody);

      if (result.success) {
        res.status(200).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  return router;
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
