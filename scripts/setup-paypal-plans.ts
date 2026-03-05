/**
 * Script to create PayPal Product and Subscription Plans
 * Run with: npx tsx scripts/setup-paypal-plans.ts
 *
 * Requires environment variables:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_MODE (sandbox or live)
 */

const PAYPAL_MODE = process.env.PAYPAL_MODE ?? 'sandbox';
const PAYPAL_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Failed to get access token: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function createProduct(accessToken: string): Promise<string> {
  console.log('Creating product...');

  const res = await fetch(`${PAYPAL_BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'TASE Data Hub Subscription',
      description: 'Access to Tel Aviv Stock Exchange end-of-day data',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create product: ${res.status} ${await res.text()}`);
  }

  const product = await res.json() as { id: string; name: string };
  console.log(`✓ Product created: ${product.id}`);
  return product.id;
}

async function createPlan(
  accessToken: string,
  productId: string,
  name: string,
  price: string,
  interval: 'MONTH' | 'YEAR',
  currency: string = 'ILS'
): Promise<string> {
  console.log(`Creating ${name} plan...`);

  const res = await fetch(`${PAYPAL_BASE}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_id: productId,
      name: name,
      description: `${name} subscription to TASE Data Hub`,
      billing_cycles: [
        {
          frequency: {
            interval_unit: interval,
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // Infinite
          pricing_scheme: {
            fixed_price: {
              value: price,
              currency_code: currency,
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create plan: ${res.status} ${await res.text()}`);
  }

  const plan = await res.json() as { id: string; name: string };
  console.log(`✓ ${name} plan created: ${plan.id}`);
  return plan.id;
}

async function main() {
  console.log(`\nPayPal Setup Script (${PAYPAL_MODE} mode)\n`);
  console.log('='.repeat(50));

  const accessToken = await getAccessToken();
  console.log('✓ Authenticated with PayPal\n');

  // Create product
  const productId = await createProduct(accessToken);

  // Create monthly plan (₪35/month)
  const monthlyPlanId = await createPlan(accessToken, productId, 'Monthly Plan', '35.00', 'MONTH', 'ILS');

  // Create yearly plan (₪350/year)
  const yearlyPlanId = await createPlan(accessToken, productId, 'Yearly Plan', '350.00', 'YEAR', 'ILS');

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Setup complete! Add these to your environment:\n');
  console.log(`PAYPAL_PLAN_MONTHLY=${monthlyPlanId}`);
  console.log(`PAYPAL_PLAN_YEARLY=${yearlyPlanId}`);
  console.log('\nOr run:');
  console.log(`railway variables set PAYPAL_PLAN_MONTHLY=${monthlyPlanId} PAYPAL_PLAN_YEARLY=${yearlyPlanId}`);
}

main().catch(console.error);
