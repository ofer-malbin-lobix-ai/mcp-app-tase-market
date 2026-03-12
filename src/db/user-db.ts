import { prisma } from './db.js';

/**
 * Ensure user record exists (lazy creation on first access).
 * If email is provided and a different user exists with that email (e.g. migrated from Clerk),
 * automatically migrates all data to the new userId (Auth0 sub).
 */
export async function ensureUser(userId: string, email?: string) {
  // Check if user already exists by ID
  const existing = await prisma.appUser.findUnique({ where: { id: userId } });
  if (existing) {
    // Update email if provided and different
    if (email && existing.email !== email) {
      return prisma.appUser.update({ where: { id: userId }, data: { email } });
    }
    return existing;
  }

  // User doesn't exist by ID — check if there's an existing user with this email (Clerk → Auth0 migration)
  if (email) {
    const existingByEmail = await prisma.appUser.findUnique({ where: { email } });
    if (existingByEmail && existingByEmail.id !== userId) {
      console.log(`[user-db] Migrating user from ${existingByEmail.id.substring(0, 30)}... to ${userId.substring(0, 30)}... (email: ${email})`);
      // Store legacy ID in subscription for PayPal webhook resolution
      const sub = await prisma.userSubscription.findUnique({ where: { userId: existingByEmail.id } });
      if (sub && !sub.legacyClerkId) {
        await prisma.userSubscription.update({
          where: { userId: existingByEmail.id },
          data: { legacyClerkId: existingByEmail.id },
        });
      }
      // Migrate: clear email on old record (unique constraint), create new user, move data, delete old
      await prisma.appUser.update({ where: { id: existingByEmail.id }, data: { email: null } });
      await prisma.appUser.create({ data: { id: userId, email } });
      await prisma.userPosition.updateMany({ where: { userId: existingByEmail.id }, data: { userId } });
      await prisma.userWatchlistItem.updateMany({ where: { userId: existingByEmail.id }, data: { userId } });
      await prisma.userSubscription.updateMany({ where: { userId: existingByEmail.id }, data: { userId } });
      await prisma.appUser.delete({ where: { id: existingByEmail.id } });
      console.log(`[user-db] Migration complete for ${email}`);
      return prisma.appUser.findUnique({ where: { id: userId } });
    }
  }

  // No existing user — create new
  return prisma.appUser.create({ data: { id: userId, email } });
}

// ─── Positions ──────────────────────────────────────────────────────

export async function getUserPositions(userId: string) {
  await ensureUser(userId);
  return prisma.userPosition.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

export async function getUserPositionSymbols(userId: string): Promise<string[]> {
  await ensureUser(userId);
  const positions = await prisma.userPosition.findMany({
    where: { userId },
    select: { symbol: true },
    orderBy: { createdAt: 'asc' },
  });
  return positions.map(p => p.symbol);
}

export async function upsertPosition(
  userId: string,
  data: { symbol: string; startDate: string; amount: number; avgEntryPrice?: number; alloc?: number; side?: string },
) {
  await ensureUser(userId);
  await prisma.userPosition.upsert({
    where: { userId_symbol: { userId, symbol: data.symbol } },
    update: {
      startDate: data.startDate,
      amount: data.amount,
      avgEntryPrice: data.avgEntryPrice ?? null,
      alloc: data.alloc ?? null,
      side: data.side ?? null,
    },
    create: {
      userId,
      symbol: data.symbol,
      startDate: data.startDate,
      amount: data.amount,
      avgEntryPrice: data.avgEntryPrice ?? null,
      alloc: data.alloc ?? null,
      side: data.side ?? null,
    },
  });
  return prisma.userPosition.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

export async function deletePosition(userId: string, symbol: string) {
  await ensureUser(userId);
  await prisma.userPosition.deleteMany({ where: { userId, symbol } });
  return prisma.userPosition.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

// ─── Watchlist ──────────────────────────────────────────────────────

export async function getUserWatchlist(userId: string) {
  await ensureUser(userId);
  return prisma.userWatchlistItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

export async function getUserWatchlistSymbols(userId: string): Promise<string[]> {
  await ensureUser(userId);
  const items = await prisma.userWatchlistItem.findMany({
    where: { userId },
    select: { symbol: true },
    orderBy: { createdAt: 'asc' },
  });
  return items.map(w => w.symbol);
}

export async function upsertWatchlistItem(
  userId: string,
  data: { symbol: string; startDate: string; note?: string },
) {
  await ensureUser(userId);
  await prisma.userWatchlistItem.upsert({
    where: { userId_symbol: { userId, symbol: data.symbol } },
    update: {
      startDate: data.startDate,
      note: data.note ?? null,
    },
    create: {
      userId,
      symbol: data.symbol,
      startDate: data.startDate,
      note: data.note ?? null,
    },
  });
  return prisma.userWatchlistItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

export async function deleteWatchlistItem(userId: string, symbol: string) {
  await ensureUser(userId);
  await prisma.userWatchlistItem.deleteMany({ where: { userId, symbol } });
  return prisma.userWatchlistItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

// ─── Subscription ───────────────────────────────────────────────────

export async function getUserSubscription(userId: string) {
  await ensureUser(userId);
  return prisma.userSubscription.findUnique({ where: { userId } });
}

export async function upsertSubscription(
  userId: string,
  data: {
    plan?: string;
    paypalSubscriptionId?: string;
    subscriptionStatus?: string;
    expiresAt?: string;
    manualSubscription?: boolean;
    freeTrial?: boolean;
    freeTrialUsed?: boolean;
  },
) {
  await ensureUser(userId);
  return prisma.userSubscription.upsert({
    where: { userId },
    update: {
      ...(data.plan !== undefined && { plan: data.plan }),
      ...(data.paypalSubscriptionId !== undefined && { paypalSubscriptionId: data.paypalSubscriptionId }),
      ...(data.subscriptionStatus !== undefined && { subscriptionStatus: data.subscriptionStatus }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
      ...(data.manualSubscription !== undefined && { manualSubscription: data.manualSubscription }),
      ...(data.freeTrial !== undefined && { freeTrial: data.freeTrial }),
      ...(data.freeTrialUsed !== undefined && { freeTrialUsed: data.freeTrialUsed }),
    },
    create: {
      userId,
      plan: data.plan ?? null,
      paypalSubscriptionId: data.paypalSubscriptionId ?? null,
      subscriptionStatus: data.subscriptionStatus ?? null,
      expiresAt: data.expiresAt ?? null,
      manualSubscription: data.manualSubscription ?? false,
      freeTrial: data.freeTrial ?? false,
      freeTrialUsed: data.freeTrialUsed ?? false,
    },
  });
}

// ─── Legacy Clerk ID lookup (for PayPal webhook migration) ──────────

export async function findUserByLegacyClerkId(clerkId: string): Promise<string | null> {
  const sub = await prisma.userSubscription.findFirst({
    where: { legacyClerkId: clerkId },
    select: { userId: true },
  });
  return sub?.userId ?? null;
}
