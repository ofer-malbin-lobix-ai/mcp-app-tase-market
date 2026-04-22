import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUser } from '../db/user-db.js';
import { createSubscription, PLANS } from '../paypal/paypal-service.js';
import { createUser } from '../auth0/auth0-management.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve HTML files path - works from both src/ and dist/
const HTML_DIR = __filename.includes('/dist/')
  ? path.join(__dirname, '..', '..', '..', 'src', 'signup')
  : __dirname;

export function createSignupRouter(): Router {
  const router = Router();

  // Serve signup page
  router.get('/signup', async (_req: Request, res: Response) => {
    try {
      const htmlPath = path.join(HTML_DIR, 'signup.html');
      let html = await fs.readFile(htmlPath, 'utf-8');

      // Inject plan info (Auth0 config no longer needed client-side)
      const config = {
        plans: {
          monthly: { price: PLANS.monthly.price, name: PLANS.monthly.name, currency: PLANS.monthly.currency },
          yearly: { price: PLANS.yearly.price, name: PLANS.yearly.name, currency: PLANS.yearly.currency },
        },
      };
      html = html.replace('</head>', `<script>window.SIGNUP_CONFIG = ${JSON.stringify(config)};</script></head>`);

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving signup page:', error);
      res.status(500).send('Error loading signup page');
    }
  });

  // Step 1: Create Auth0 account (server-side, bypasses "Disable Sign Ups")
  router.post('/api/signup/create-account', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email: string; password: string };

      if (!email || !password) {
        res.status(400).json({ error: 'Missing required fields: email, password' });
        return;
      }

      const connection = process.env.AUTH0_DB_CONNECTION ?? 'Username-Password-Authentication';
      const result = await createUser(email, password, connection);

      // Ensure user exists in our DB
      await ensureUser(result.user_id, email);

      res.json({ auth0UserId: result.user_id });
    } catch (error: any) {
      console.error('Error creating account:', error);
      const statusCode = error.statusCode === 409 ? 409 : error.statusCode ?? 500;
      res.status(statusCode).json({ error: error.message ?? 'Failed to create account' });
    }
  });

  // Step 2: Start PayPal subscription
  router.post('/api/signup/subscribe', async (req: Request, res: Response) => {
    try {
      const { auth0UserId, email, planType } = req.body as {
        auth0UserId: string;
        email: string;
        planType: 'monthly' | 'yearly';
      };

      if (!auth0UserId || !email || !planType) {
        res.status(400).json({ error: 'Missing required fields: auth0UserId, email, planType' });
        return;
      }

      if (!['monthly', 'yearly'].includes(planType)) {
        res.status(400).json({ error: 'Invalid plan type' });
        return;
      }

      // Ensure user exists in our DB
      await ensureUser(auth0UserId, email);

      // Create PayPal subscription with auth0UserId as custom_id
      const result = await createSubscription(planType, auth0UserId);

      res.json(result);
    } catch (error) {
      console.error('Error in signup/subscribe:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  });

  return router;
}
