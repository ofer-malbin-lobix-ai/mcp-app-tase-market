---
disable-model-invocation: true
---

# Subscription Process

Reference for the full subscription system — signup, PayPal checkout, webhooks, Auth0 user management, and middleware.

## Architecture Overview

The subscription system is split into two completely separate concerns:

1. **Web pages** (regular Express routes) — account creation, PayPal subscription, management
2. **MCP server** (`/mcp` endpoint) — sign-in via OAuth, subscription check, market data tools

**ChatGPT/Claude never touches commerce.** Signup and subscription are a "preliminary stage" — like Google Workspace signup happens before using a Google connector.

```
Web Browser (preliminary stage)
        │
        ▼
  /signup page (signup.html)
   ├─ Step 1: Create Auth0 account (via Management API)
   └─ Step 2: Choose plan → PayPal checkout
        │
        ▼
  signup-routes.ts → auth0-management.ts → Auth0 Management API
                   → paypal-service.ts → PayPal API
        │
        ▼
  PayPal success callback → webhook-handler.ts
   ├─ upserts subscription in DB
   └─ unblocks Auth0 account (on activate)
       or blocks Auth0 account (on cancel/suspend/expire)

ChatGPT / Claude Desktop (sign-in only)
        │
        ▼
  main.ts middleware (mcpAuth → requireSubscription)
   ├─ OAuth sign-in via Auth0
   ├─ Subscription check (checkSubscription)
   └─ Returns 401 if no active subscription
       → ChatGPT triggers re-auth
       → Blocked user sees "Account suspended"
```

## Key Files

| File | Purpose |
|------|---------|
| `src/signup/signup-routes.ts` | `POST /api/signup/create-account` (Auth0 user creation), `POST /api/signup/subscribe` (PayPal subscription) |
| `src/signup/signup.html` | Two-step signup page: create account → choose plan → PayPal checkout |
| `src/auth0/auth0-management.ts` | Auth0 Management API — `createUser()`, `blockUser()`, `unblockUser()` with token caching |
| `src/paypal/paypal-service.ts` | PayPal API client — `createSubscription()`, `cancelSubscription()`, `getSubscription()`, `verifyWebhookSignature()`, plan config |
| `src/paypal/subscription-routes.ts` | Existing subscription management — subscribe page, status, cancel, PayPal callbacks, webhook |
| `src/paypal/subscription-check.ts` | `checkSubscription()` with 5-min in-memory cache |
| `src/paypal/webhook-handler.ts` | Handles PayPal events + blocks/unblocks Auth0 accounts |
| `src/paypal/subscribe-token.ts` | HMAC-SHA256 signed token for subscribe page auth |
| `src/paypal/subscribe.html` | Subscription management page (for existing users) |
| `src/db/user-db.ts` | `ensureUser()`, `getUserSubscription()`, `upsertSubscription()` |
| `main.ts` | `requireSubscription` middleware — returns 401 for unsubscribed users |

## Database Schema

```prisma
model UserSubscription {
  id                   String   @id @default(cuid())
  userId               String   @unique
  plan                 String?          // "monthly" | "yearly"
  paypalSubscriptionId String?          // PayPal subscription ID
  subscriptionStatus   String?          // "active" | "cancelled" | "suspended" | "expired"
  expiresAt            String?          // ISO date string "YYYY-MM-DD"
  manualSubscription   Boolean  @default(false)
  freeTrial            Boolean  @default(false)
  freeTrialUsed        Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  user                 AppUser  @relation(...)
}
```

## Plans

| Plan | Price | Interval | Env Var |
|------|-------|----------|---------|
| Monthly | 35 ILS | MONTH | `PAYPAL_PLAN_MONTHLY` |
| Yearly | 350 ILS | YEAR | `PAYPAL_PLAN_YEARLY` |

7-day money-back guarantee (cancel within 7 days for full refund). No free trial.

## End-to-End Flows

### New User Signup
1. User visits `/signup` in browser
2. Enters email + password → `POST /api/signup/create-account`
3. Server creates Auth0 user via Management API (`createUser()`)
4. Server creates DB user via `ensureUser()`
5. User selects plan → `POST /api/signup/subscribe`
6. Server creates PayPal subscription → returns approval URL
7. User redirected to PayPal → approves payment
8. PayPal redirects to `/api/paypal/success` → DB updated, cache cleared
9. PayPal webhook `BILLING.SUBSCRIPTION.ACTIVATED` → unblocks Auth0 account

### Sign-in from ChatGPT/Claude
1. MCP client connects to `/mcp`
2. No auth header → 401 with PRM metadata → client initiates OAuth
3. Auth0 login screen (signup disabled) → user logs in
4. JWT validated → `requireSubscription` checks subscription
5. Active subscription → tools work
6. No subscription → 401 → re-auth triggered → blocked user sees "Account suspended"

### Subscription Cancelled
1. User cancels via `/subscribe` page or PayPal directly
2. PayPal webhook `BILLING.SUBSCRIPTION.CANCELLED` fires
3. DB updated with `subscriptionStatus: 'cancelled'`
4. Auth0 account **blocked** via `blockUser()`
5. Next ChatGPT tool call → JWT valid but subscription check fails → 401
6. ChatGPT triggers re-auth → Auth0 login fails (account blocked)

### Resubscribe
1. User goes to `/signup` or `/subscribe` on website
2. Completes new PayPal subscription
3. PayPal webhook `BILLING.SUBSCRIPTION.ACTIVATED` → DB updated, Auth0 account **unblocked**
4. User can sign in from ChatGPT again

## Middleware Details

**Location:** `main.ts`, applied to `/mcp` POST endpoint

**Behavior:**
- Only triggers on `method: "tools/call"` (skips `initialize`, `tools/list`, etc.)
- Exempt tools: `get-tase-market-settings-data`, `show-tase-market-settings-widget`, `show-tase-market-home-widget`
- If no active subscription → returns 401 with `WWW-Authenticate` header
- No auto-trial, no subscribe URL, no in-app commerce

## Auth0 Management API

**File:** `src/auth0/auth0-management.ts`

**Important:** Uses `AUTH0_MGMT_DOMAIN` (actual tenant domain `lobix-ai.us.auth0.com`), NOT the custom domain `auth.lobix.ai`. The Management API doesn't work with custom domains.

| Function | Purpose |
|----------|---------|
| `createUser(email, password, connection)` | Creates Auth0 user via `POST /api/v2/users` |
| `blockUser(auth0UserId)` | Blocks user via `PATCH /api/v2/users/{id}` — prevents login |
| `unblockUser(auth0UserId)` | Unblocks user — allows login again |

## Webhook Events

| Event | Handler | DB Action | Auth0 Action |
|-------|---------|-----------|--------------|
| `BILLING.SUBSCRIPTION.ACTIVATED` | `handleSubscriptionActivated` | Set `active` | `unblockUser()` |
| `BILLING.SUBSCRIPTION.CANCELLED` | `handleSubscriptionCancelled` | Set `cancelled` | `blockUser()` |
| `BILLING.SUBSCRIPTION.SUSPENDED` | `handleSubscriptionSuspended` | Set `suspended` | `blockUser()` |
| `BILLING.SUBSCRIPTION.EXPIRED` | `handleSubscriptionExpired` | Set `expired` | `blockUser()` |
| `PAYMENT.SALE.COMPLETED` | `handlePaymentCompleted` | Update expiry | — |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUTH0_MGMT_DOMAIN` | Auth0 tenant domain for Management API (NOT custom domain) |
| `AUTH0_MGMT_CLIENT_ID` | M2M app client ID |
| `AUTH0_MGMT_CLIENT_SECRET` | M2M app client secret |
| `AUTH0_DB_CONNECTION` | Database connection name (default: `Username-Password-Authentication`) |
| `PAYPAL_MODE` | `sandbox` or `live` |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret |
| `PAYPAL_PLAN_MONTHLY` | PayPal billing plan ID for monthly |
| `PAYPAL_PLAN_YEARLY` | PayPal billing plan ID for yearly |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID for signature verification |
| `SUBSCRIBE_TOKEN_SECRET` | HMAC secret for subscribe page tokens |
| `APP_URL` | Public app URL |

## HTTP Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/signup` | Public | Signup + subscribe page |
| POST | `/api/signup/create-account` | Public | Create Auth0 account |
| POST | `/api/signup/subscribe` | Public | Start PayPal subscription |
| GET | `/subscribe` | Token | Subscription management page |
| GET | `/api/subscription/status` | Token | Subscription status JSON |
| POST | `/api/paypal/create-subscription` | Token | Create PayPal subscription |
| POST | `/api/paypal/cancel-subscription` | Token | Cancel subscription |
| GET | `/api/paypal/success` | Public | PayPal return URL |
| GET | `/api/paypal/cancel` | Public | PayPal cancel URL |
| GET | `/paypal/result` | Public | Result page |
| POST | `/api/paypal/webhook` | PayPal signature | Webhook receiver |
