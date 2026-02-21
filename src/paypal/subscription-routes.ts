import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, getAuth, clerkClient } from '@clerk/express';
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
import { clearSubscriptionCache } from './subscription-check.js';
import { verifySubscribeToken } from './subscribe-token.js';
import type { CreateSubscriptionRequest, SubscriptionMetadata } from './types.js';

// Helper to get userId from token or Clerk session
function resolveUserId(req: Request): string | null {
  // First try token from query or body
  const token = (req.query.token as string) || (req.body as { token?: string })?.token;
  if (token) {
    const userId = verifySubscribeToken(token);
    if (userId) return userId;
  }

  // Fall back to Clerk session
  const auth = getAuth(req);
  return auth?.userId ?? null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve HTML files path - works from both src/ and dist/
const HTML_DIR = __filename.includes('/dist/')
  ? path.join(__dirname, '..', '..', '..', 'src', 'paypal')  // from dist/src/paypal/ to src/paypal/
  : __dirname;  // from src/paypal/

export function createSubscriptionRouter(): Router {
  const router = Router();

  // Serve subscription page (accepts token or Clerk session)
  router.get('/subscribe', async (req: Request, res: Response) => {
    const userId = resolveUserId(req);

    try {
      const htmlPath = path.join(HTML_DIR, 'subscribe.html');
      let html = await fs.readFile(htmlPath, 'utf-8');

      // Inject Clerk publishable key for browser-side auth
      const clerkPk = process.env.CLERK_PUBLISHABLE_KEY ?? '';
      html = html.replace('data-clerk-publishable-key=""', `data-clerk-publishable-key="${clerkPk}"`);
      html = html.replace('</head>', `<script>window.CLERK_PUBLISHABLE_KEY = "${clerkPk}";</script></head>`);

      if (!userId) {
        // No valid token or Clerk session — serve the page with Clerk JS for sign-in
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
        const user = await clerkClient.users.getUser(userId);
        const metadata = user.publicMetadata as Partial<SubscriptionMetadata>;
        const status = {
          hasSubscription: !!metadata.paypal_subscription_id,
          plan: metadata.plan ?? null,
          status: metadata.subscription_status ?? null,
          expiresAt: metadata.expires_at ?? null,
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

  // Get subscription status (accepts token or Clerk session)
  router.get('/api/subscription/status', async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await clerkClient.users.getUser(userId);
      const metadata = user.publicMetadata as Partial<SubscriptionMetadata>;

      res.json({
        hasSubscription: !!metadata.paypal_subscription_id,
        plan: metadata.plan ?? null,
        status: metadata.subscription_status ?? null,
        expiresAt: metadata.expires_at ?? null,
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

  // Create subscription (accepts token or Clerk session)
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

      const user = await clerkClient.users.getUser(userId);
      const metadata = user.publicMetadata as Partial<SubscriptionMetadata>;

      if (metadata.subscription_status === 'active') {
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

      const metadata: SubscriptionMetadata = {
        plan: planType,
        paypal_subscription_id: subscriptionId,
        subscription_status: 'active',
        expires_at: expiresAt,
      };

      await clerkClient.users.updateUser(userId, {
        publicMetadata: metadata,
      });

      // Clear subscription cache so MCP requests get fresh status
      clearSubscriptionCache(userId);

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

  // Cancel subscription
  router.post('/api/paypal/cancel-subscription', requireAuth(), async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await clerkClient.users.getUser(userId);
      const metadata = user.publicMetadata as Partial<SubscriptionMetadata>;

      if (!metadata.paypal_subscription_id) {
        res.status(400).json({ error: 'No active subscription found' });
        return;
      }

      await cancelSubscription(metadata.paypal_subscription_id);

      const updatedMetadata: SubscriptionMetadata = {
        plan: metadata.plan ?? 'monthly',
        paypal_subscription_id: metadata.paypal_subscription_id,
        subscription_status: 'cancelled',
        expires_at: metadata.expires_at ?? new Date().toISOString().split('T')[0],
      };

      await clerkClient.users.updateUser(userId, {
        publicMetadata: updatedMetadata,
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
