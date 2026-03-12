import { prisma } from './db.js';

/**
 * Ensure user record exists (lazy creation on first access).
 */
export async function ensureUser(userId: string, email?: string) {
  const existing = await prisma.appUser.findUnique({ where: { id: userId } });
  if (existing) {
    if (email && existing.email !== email) {
      return prisma.appUser.update({ where: { id: userId }, data: { email } });
    }
    return existing;
  }

  const user = await prisma.appUser.create({ data: { id: userId, email } });

  // Auto-grant 7-day free trial for new users
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.userSubscription.create({
    data: {
      userId,
      freeTrial: true,
      freeTrialUsed: true,
      expiresAt: expiresAt.toISOString().split('T')[0],
    },
  });

  return user;
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
