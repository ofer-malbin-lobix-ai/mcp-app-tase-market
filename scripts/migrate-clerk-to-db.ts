/**
 * Migration script: Clerk → PostgreSQL
 *
 * Migrates user data (positions, watchlist, subscriptions) from Clerk metadata
 * to the new Prisma models (AppUser, UserPosition, UserWatchlistItem, UserSubscription).
 *
 * Prerequisites:
 * - CLERK_SECRET_KEY in .env.local (for reading existing Clerk users)
 * - AUTH0_MANAGEMENT_DOMAIN, AUTH0_MANAGEMENT_CLIENT_ID, AUTH0_MANAGEMENT_CLIENT_SECRET (for looking up Auth0 sub by email)
 * - DATABASE_URL in .env.local
 * - Run `npx prisma migrate dev --name add-user-models` first
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/migrate-clerk-to-db.ts
 */

import { prisma } from '../src/db/db.js';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const AUTH0_DOMAIN = process.env.AUTH0_MANAGEMENT_DOMAIN ?? process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET;

if (!CLERK_SECRET_KEY) {
  console.error('CLERK_SECRET_KEY is required');
  process.exit(1);
}

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string }>;
  private_metadata: Record<string, unknown>;
  public_metadata: Record<string, unknown>;
}

interface UserPosition {
  symbol: string;
  startDate: string;
  amount: number;
  avgEntryPrice?: number;
  alloc?: number;
  side?: string;
}

interface UserWatchlistItem {
  symbol: string;
  startDate: string;
  note?: string;
}

// Fetch all Clerk users
async function fetchClerkUsers(): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(`https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!response.ok) throw new Error(`Clerk API error: ${response.status} ${await response.text()}`);
    const batch = await response.json() as ClerkUser[];
    users.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return users;
}

// Get Auth0 Management API token
async function getAuth0Token(): Promise<string | null> {
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET) {
    console.warn('Auth0 Management API credentials not configured — will use Clerk IDs as fallback');
    return null;
  }

  const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET,
      audience: `https://${AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    console.warn(`Auth0 token request failed: ${response.status} — will use Clerk IDs as fallback`);
    return null;
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// Look up Auth0 user by email
async function findAuth0Sub(email: string, token: string): Promise<string | null> {
  const response = await fetch(
    `https://${AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) return null;
  const users = await response.json() as Array<{ user_id: string }>;
  return users.length > 0 ? users[0].user_id : null;
}

async function main() {
  console.log('Fetching Clerk users...');
  const clerkUsers = await fetchClerkUsers();
  console.log(`Found ${clerkUsers.length} Clerk users`);

  const auth0Token = await getAuth0Token();

  let migrated = 0;
  let skipped = 0;

  for (const user of clerkUsers) {
    const email = user.email_addresses[0]?.email_address;
    let auth0Sub: string | null = null;

    if (auth0Token && email) {
      auth0Sub = await findAuth0Sub(email, auth0Token);
    }

    // Use Auth0 sub if found, otherwise use Clerk ID as a temporary ID
    const userId = auth0Sub ?? user.id;
    const legacyClerkId = auth0Sub ? user.id : undefined;

    console.log(`\nMigrating user: ${email ?? 'no-email'} (clerk: ${user.id}, target: ${userId})`);

    // Create AppUser
    await prisma.appUser.upsert({
      where: { id: userId },
      update: { email },
      create: { id: userId, email },
    });

    // Migrate positions
    const positions = (user.private_metadata?.positions as UserPosition[] | undefined) ?? [];
    for (const p of positions) {
      await prisma.userPosition.upsert({
        where: { userId_symbol: { userId, symbol: p.symbol } },
        update: {
          startDate: p.startDate,
          amount: p.amount,
          avgEntryPrice: p.avgEntryPrice ?? null,
          alloc: p.alloc ?? null,
          side: p.side ?? null,
        },
        create: {
          userId,
          symbol: p.symbol,
          startDate: p.startDate,
          amount: p.amount,
          avgEntryPrice: p.avgEntryPrice ?? null,
          alloc: p.alloc ?? null,
          side: p.side ?? null,
        },
      });
    }
    if (positions.length > 0) console.log(`  Migrated ${positions.length} positions`);

    // Migrate watchlist
    const watchlist = (user.private_metadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
    for (const w of watchlist) {
      await prisma.userWatchlistItem.upsert({
        where: { userId_symbol: { userId, symbol: w.symbol } },
        update: { startDate: w.startDate, note: w.note ?? null },
        create: { userId, symbol: w.symbol, startDate: w.startDate, note: w.note ?? null },
      });
    }
    if (watchlist.length > 0) console.log(`  Migrated ${watchlist.length} watchlist items`);

    // Migrate subscription
    const subscriptions = (user.public_metadata?.subscriptions as Record<string, unknown> | undefined) ?? {};
    const sub = subscriptions['tase-market'] as Record<string, unknown> | undefined;
    if (sub) {
      await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan: (sub.plan as string) ?? null,
          paypalSubscriptionId: (sub.paypal_subscription_id as string) ?? null,
          subscriptionStatus: (sub.subscription_status as string) ?? null,
          expiresAt: (sub.expires_at as string) ?? null,
          manualSubscription: !!sub.manual_subscription,
          freeTrial: !!sub.free_trial,
          freeTrialUsed: !!sub.free_trial_used,
          legacyClerkId,
        },
        create: {
          userId,
          plan: (sub.plan as string) ?? null,
          paypalSubscriptionId: (sub.paypal_subscription_id as string) ?? null,
          subscriptionStatus: (sub.subscription_status as string) ?? null,
          expiresAt: (sub.expires_at as string) ?? null,
          manualSubscription: !!sub.manual_subscription,
          freeTrial: !!sub.free_trial,
          freeTrialUsed: !!sub.free_trial_used,
          legacyClerkId,
        },
      });
      console.log(`  Migrated subscription (plan: ${sub.plan ?? 'none'}, status: ${sub.subscription_status ?? 'none'})`);
    }

    migrated++;
  }

  console.log(`\nDone! Migrated: ${migrated}, Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
