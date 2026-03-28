---
disable-model-invocation: true
---

# Subscription Process

Reference for the full PayPal subscription system — plans, checkout, webhooks, free trials, middleware, and database.

## Architecture Overview

```
Claude Desktop / MCP Client
        │
        ▼
  main.ts middleware (requireSubscription)
   ├─ tools/call only, exempt tools skip
   ├─ auto-grants 7-day free trial on first call
   └─ returns subscribeUrl if no active subscription
        │
        ▼
  subscribe.html (subscription management page)
   ├─ shows plans, status, cancel button
   └─ bilingual EN/HE
        │
        ▼
  subscription-routes.ts → paypal-service.ts → PayPal API
        │                                          │
        ▼                                          ▼
  success callback ──────────────────────── webhook-handler.ts
        │                                          │
        ▼                                          ▼
  user-db.ts (upsert) ◄───────────────── user-db.ts (upsert)
        │
        ▼
  subscription-check.ts (5-min cache)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/paypal/paypal-service.ts` | PayPal API client — `createSubscription()`, `cancelSubscription()`, `getSubscription()`, `verifyWebhookSignature()`, token caching, plan config (`PLANS`) |
| `src/paypal/subscription-routes.ts` | HTTP endpoints — subscribe page, status, create, cancel, success/cancel callbacks, webhook, free trial start |
| `src/paypal/subscription-check.ts` | `checkSubscription()` with 5-min in-memory cache, checks manual → trial → PayPal subscriptions in order |
| `src/paypal/webhook-handler.ts` | Handles `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.COMPLETED` events with signature verification |
| `src/paypal/subscribe-token.ts` | HMAC-SHA256 signed token generation/verification, 30-min expiry, base64url encoded |
| `src/paypal/subscribe.html` | Subscription management page — plan cards, status display, cancel button, bilingual EN/HE |
| `src/paypal/paypal-result.html` | Post-checkout result page — success/cancel/error messaging |
| `src/paypal/types.ts` | Type definitions — `PlanConfig`, `PayPalSubscription`, `PayPalWebhookEvent`, `PayPalTokenResponse`, `CreateSubscriptionRequest` |
| `src/db/user-db.ts` | `getUserSubscription()` (line ~110), `upsertSubscription()` (line ~115) — Prisma upsert with selective field updates |
| `prisma/schema.prisma` | `UserSubscription` model (line ~114) |
| `main.ts` | Subscription check middleware `requireSubscription` (line ~172), auto-trial logic, subscribeUrl response |
| `server.ts` | Settings/home MCP tools (lines ~1410–1535) — `show-tase-market-home-widget`, `get-tase-market-settings-data`, `show-tase-market-settings-widget` |

## Database Schema

```prisma
model UserSubscription {
  id                   String   @id @default(cuid())
  userId               String   @unique
  plan                 String?          // "monthly" | "yearly"
  paypalSubscriptionId String?          // PayPal subscription ID (e.g., "I-XXXXXXXXXX")
  subscriptionStatus   String?          // "active" | "cancelled" | "suspended" | "expired"
  expiresAt            String?          // ISO date string "YYYY-MM-DD"
  manualSubscription   Boolean  @default(false)  // admin-granted prepaid subscription
  freeTrial            Boolean  @default(false)  // currently on free trial
  freeTrialUsed        Boolean  @default(false)  // prevents reuse of trial
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  user                 AppUser  @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## Plans

| Plan | Price | Interval | Env Var |
|------|-------|----------|---------|
| Monthly | 35 ILS | MONTH | `PAYPAL_PLAN_MONTHLY` |
| Yearly | 350 ILS | YEAR | `PAYPAL_PLAN_YEARLY` |

Plans are configured in `paypal-service.ts` via the `PLANS` object. Plan IDs come from PayPal billing plan setup.

## End-to-End Flows

### Free Trial (auto-granted)
1. User makes first `tools/call` request via MCP
2. `requireSubscription` middleware finds no subscription record
3. Auto-creates `UserSubscription` with `freeTrial: true`, `freeTrialUsed: true`, `expiresAt` = now + 7 days
4. Request proceeds; `freeTrialUsed` flag prevents reuse after expiry

### PayPal Subscription
1. Settings/home widget shows subscribe link with HMAC token → `GET /subscribe?token=...`
2. `subscribe.html` displays plan cards (monthly/yearly) with injected status
3. User clicks plan → `POST /api/paypal/create-subscription` with `{ planType, token }`
4. Server calls `paypal-service.createSubscription()` → returns PayPal approval URL
5. User redirected to PayPal for approval
6. PayPal redirects to `GET /api/paypal/success?subscription_id=...`
7. Success callback fetches subscription from PayPal, upserts DB with `subscriptionStatus: 'active'`
8. Clears subscription cache, redirects to `/paypal/result?success=true`
9. Webhook `BILLING.SUBSCRIPTION.ACTIVATED` confirms (idempotent DB update)

### Free Trial (via subscribe page)
1. Subscribe page shows "Start Free Trial" button if `freeTrialUsed` is false
2. `POST /api/paypal/start-free-trial` with token
3. Sets `freeTrial: true`, `freeTrialUsed: true`, `expiresAt` = now + 7 days
4. Clears subscription cache

### Cancellation
1. Subscribe page shows cancel button for active PayPal subscriptions
2. `POST /api/paypal/cancel-subscription` with token
3. Calls `paypal-service.cancelSubscription()` → PayPal API
4. Updates DB with `subscriptionStatus: 'cancelled'`
5. Webhook `BILLING.SUBSCRIPTION.CANCELLED` confirms

## Middleware Details

**Location:** `main.ts` line ~172, applied to `/mcp` POST endpoint

**Behavior:**
- Only triggers on `method: "tools/call"` (skips `initialize`, `tools/list`, etc.)
- Exempt tools (no subscription needed): `get-tase-market-settings-data`, `show-tase-market-settings-widget`, `show-tase-market-home-widget`
- If no userId (auth failed), passes through to let auth middleware handle 401
- If no subscription exists at all, auto-grants 7-day free trial and continues
- If subscription expired/cancelled, returns JSON-RPC response with `subscribeUrl` and settings widget UI resource URI

**Response when subscription required:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{ "type": "text", "text": "{\"subscribeUrl\":\"...\",\"needsSubscription\":true}" }],
    "_meta": { "ui": { "resourceUri": "ui://tase-end-of-day/tase-market-settings-widget-ver-X.html" } }
  },
  "id": "<request-id>"
}
```

## Subscription Check Priority

`checkSubscription()` in `subscription-check.ts` checks in this order:
1. **Cache** — 5-min TTL in-memory Map
2. **Manual subscription** — `manualSubscription: true` + `expiresAt` in the future
3. **Free trial** — `freeTrial: true` + `expiresAt` in the future
4. **PayPal subscription** — `paypalSubscriptionId` exists + `subscriptionStatus === 'active'`
5. **Optional PayPal verification** — if `VERIFY_SUBSCRIPTION_WITH_PAYPAL=true`, calls PayPal API to confirm

## Webhook Events

| Event | Handler | Action |
|-------|---------|--------|
| `BILLING.SUBSCRIPTION.ACTIVATED` | `handleSubscriptionActivated` | Fetch subscription from PayPal, upsert with `active` status and expiry from `next_billing_time` |
| `BILLING.SUBSCRIPTION.CANCELLED` | `handleSubscriptionCancelled` | Update status to `cancelled`, keep existing expiry |
| `BILLING.SUBSCRIPTION.SUSPENDED` | `handleSubscriptionSuspended` | Update status to `suspended` |
| `BILLING.SUBSCRIPTION.EXPIRED` | `handleSubscriptionExpired` | Update status to `expired`, set expiry to today |
| `PAYMENT.SALE.COMPLETED` | `handlePaymentCompleted` | Renewal — fetch subscription for new `next_billing_time`, update expiry, confirm `active` |

All handlers verify `custom_id` (userId) from the webhook payload and clear the subscription cache after updates.

Webhook endpoint: `POST /api/paypal/webhook` — verifies signature via `paypal-service.verifyWebhookSignature()`.

## Subscribe Token

- Generated by `generateSubscribeToken(userId)` in `subscribe-token.ts`
- Format: base64url(`JSON.stringify({userId, exp}).HMAC-SHA256-hex`)
- 30-minute expiry (`TOKEN_EXPIRY_MS`)
- Secret from `SUBSCRIBE_TOKEN_SECRET` env var (falls back to `'fallback-secret'`)
- Used in query params (`?token=...`) and request bodies (`{ token }`)
- `verifySubscribeToken(token)` returns `userId` or `null`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAYPAL_MODE` | `sandbox` or `live` — determines PayPal API base URL |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret |
| `PAYPAL_PLAN_MONTHLY` | PayPal billing plan ID for monthly plan |
| `PAYPAL_PLAN_YEARLY` | PayPal billing plan ID for yearly plan |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID for signature verification |
| `SUBSCRIBE_TOKEN_SECRET` | HMAC secret for subscribe tokens |
| `VERIFY_SUBSCRIPTION_WITH_PAYPAL` | `true` to verify subscription status with PayPal API on each check |
| `APP_URL` | Public app URL for callbacks and subscribe links |

## HTTP Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/subscribe` | Token (query) | Serve subscription management page |
| GET | `/api/subscription/status` | Token (query) | Get user's subscription status JSON |
| POST | `/api/paypal/create-subscription` | Token (body) | Create PayPal subscription, return approval URL |
| POST | `/api/paypal/start-free-trial` | Token (body) | Start 7-day free trial |
| GET | `/api/paypal/success` | Public | PayPal return URL after approval |
| GET | `/api/paypal/cancel` | Public | PayPal return URL after cancellation |
| GET | `/paypal/result` | Public | Result page (success/cancel/error) |
| POST | `/api/paypal/cancel-subscription` | Token (body) | Cancel active PayPal subscription |
| POST | `/api/paypal/webhook` | PayPal signature | Webhook receiver |

## Debugging

**Common issues:**
- **Webhook signature failures** — Ensure `PAYPAL_WEBHOOK_ID` matches PayPal dashboard. Sandbox and live have different webhook IDs. Raw body must be preserved (not re-serialized).
- **Token expiry** — Subscribe tokens expire in 30 minutes. If a user takes too long, the page API calls will fail with 401. Token is generated fresh each time the settings widget is loaded.
- **Cache staleness** — Subscription cache is 5 minutes. After PayPal changes, `clearSubscriptionCache(userId)` must be called. If webhook is delayed, user may see stale status briefly.
- **Sandbox vs live** — `PAYPAL_MODE` controls API base URL. Plan IDs are different between sandbox and live. Webhook IDs are different.
- **"Already has active subscription"** — The create endpoint checks `subscriptionStatus === 'active'` before creating. If a previous subscription wasn't properly cancelled, this blocks new subscriptions.
- **HTML file path resolution** — `subscription-routes.ts` resolves HTML files relative to source, handling both `src/` and `dist/` directory structures.
