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
   └─ addAppSubscription (on activate) with expiresAt
       or removeAppSubscription (on cancel/suspend/expire)

ChatGPT / Claude Desktop (sign-in only)
        │
        ▼
  main.ts middleware (mcpAuth)
   ├─ OAuth sign-in via Auth0
   ├─ JWT contains https://auth.lobix.ai/apps claim
   └─ Checks "tase-market" is in apps claim → 403 if not
       Auth0 Action filters expired apps at login time
```

## Key Files

| File | Purpose |
|------|---------|
| `src/signup/signup-routes.ts` | `POST /api/signup/create-account` (Auth0 user creation), `POST /api/signup/subscribe` (PayPal subscription) |
| `src/signup/signup.html` | Two-step signup page: create account → choose plan → PayPal checkout |
| `src/auth0/auth0-management.ts` | Auth0 Management API — `createUser()`, `addAppSubscription()`, `removeAppSubscription()` with token caching |
| `src/paypal/paypal-service.ts` | PayPal API client — `createSubscription()`, `cancelSubscription()`, `getSubscription()`, `verifyWebhookSignature()`, plan config |
| `src/paypal/subscription-routes.ts` | Subscription management web page — status, cancel, PayPal callbacks, webhook |
| `src/paypal/webhook-handler.ts` | Handles PayPal events + manages per-app access in Auth0 |
| `src/paypal/subscribe-token.ts` | HMAC-SHA256 signed token for subscribe page auth |
| `src/paypal/subscribe.html` | Subscription management page (for existing users) |
| `src/db/user-db.ts` | `ensureUser()`, `getUserSubscription()`, `upsertSubscription()` |
| `main.ts` | `mcpAuth` middleware — JWT validation + per-app access check via custom claim |

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
3. Server creates Auth0 user via Management API (`createUser()`) + creates DB user (`ensureUser()`)
4. User selects plan → `POST /api/signup/subscribe`
5. Server creates PayPal subscription → redirects to PayPal
6. User approves payment → PayPal webhook `ACTIVATED` → DB updated + `addAppSubscription("tase-market")`

### Sign-in from ChatGPT/Claude
1. `POST /mcp` → `mcpAuth`: No auth header → 401 → client starts OAuth
2. Auth0 login (signup disabled) → JWT returned with `https://auth.lobix.ai/apps` claim
3. `mcpAuth`: Validates JWT → checks `"tase-market"` is in apps claim → tool works
4. **No subscription middleware. No DB check. Just JWT auth + apps claim.**

### Subscription Cancelled
1. PayPal webhook `CANCELLED`/`SUSPENDED`/`EXPIRED`
2. DB updated + `removeAppSubscription("tase-market")` removes app from `app_metadata.apps`
3. User's JWT still works until expiry (max 24h)
4. When JWT expires → new token won't include `"tase-market"` → 403

### Resubscribe
1. User visits website → completes new PayPal subscription
2. PayPal webhook `ACTIVATED` → `addAppSubscription("tase-market")` → next JWT includes the app

## Per-App Access via JWT Custom Claims

**Claim key:** `https://auth.lobix.ai/apps`
**Auth0 Action:** `Inject app subscriptions` (Post Login, ID: `6b5fa20f-3b3d-4f2b-82e9-174cc30c2234`)

The Auth0 Action reads `app_metadata.apps` and injects it into the JWT. Each MCP app checks for its own app ID in `mcpAuth` middleware. No per-call DB check needed.

## Auth0 Management API

**File:** `src/auth0/auth0-management.ts`

**Important:** Uses `AUTH0_MGMT_DOMAIN` (actual tenant domain `lobix-ai.us.auth0.com`), NOT the custom domain `auth.lobix.ai`. The Management API doesn't work with custom domains.

| Function | Purpose |
|----------|---------|
| `createUser(email, password, connection)` | Creates Auth0 user via `POST /api/v2/users` |
| `addAppSubscription(userId, appId)` | Adds app to `app_metadata.apps` array |
| `removeAppSubscription(userId, appId)` | Removes app from `app_metadata.apps` array |
| `blockUser(auth0UserId)` | Blocks user entirely (legacy, kept for admin use) |
| `unblockUser(auth0UserId)` | Unblocks user (legacy, kept for admin use) |

## Webhook Events

| Event | Handler | DB Action | Auth0 Action |
|-------|---------|-----------|--------------|
| `BILLING.SUBSCRIPTION.ACTIVATED` | `handleSubscriptionActivated` | Set `active` | `addAppSubscription("tase-market")` |
| `BILLING.SUBSCRIPTION.CANCELLED` | `handleSubscriptionCancelled` | Set `cancelled` | `removeAppSubscription("tase-market")` |
| `BILLING.SUBSCRIPTION.SUSPENDED` | `handleSubscriptionSuspended` | Set `suspended` | `removeAppSubscription("tase-market")` |
| `BILLING.SUBSCRIPTION.EXPIRED` | `handleSubscriptionExpired` | Set `expired` | `removeAppSubscription("tase-market")` |
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
