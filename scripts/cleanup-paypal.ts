/**
 * Script to cleanup PayPal Plans and Subscriptions
 * Run with: npx tsx scripts/cleanup-paypal.ts
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

async function listPlans(accessToken: string): Promise<Array<{ id: string; name: string; status: string }>> {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/plans?page_size=20&total_required=true`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`Failed to list plans: ${res.status}`);
    return [];
  }

  const data = await res.json() as { plans?: Array<{ id: string; name: string; status: string }> };
  return data.plans ?? [];
}

async function deactivatePlan(accessToken: string, planId: string): Promise<boolean> {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/plans/${planId}/deactivate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  return res.ok || res.status === 204;
}

async function listProducts(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${PAYPAL_BASE}/v1/catalogs/products?page_size=20&total_required=true`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`Failed to list products: ${res.status}`);
    return [];
  }

  const data = await res.json() as { products?: Array<{ id: string; name: string }> };
  return data.products ?? [];
}

async function main() {
  console.log(`\nPayPal Cleanup Script (${PAYPAL_MODE} mode)\n`);
  console.log('='.repeat(50));

  const accessToken = await getAccessToken();
  console.log('✓ Authenticated with PayPal\n');

  // List and deactivate all plans
  console.log('Fetching plans...');
  const plans = await listPlans(accessToken);
  console.log(`Found ${plans.length} plans\n`);

  for (const plan of plans) {
    console.log(`Plan: ${plan.id} - ${plan.name} (${plan.status})`);
    if (plan.status === 'ACTIVE') {
      const success = await deactivatePlan(accessToken, plan.id);
      if (success) {
        console.log(`  ✓ Deactivated`);
      } else {
        console.log(`  ✗ Failed to deactivate`);
      }
    } else {
      console.log(`  - Already inactive`);
    }
  }

  // List products
  console.log('\nFetching products...');
  const products = await listProducts(accessToken);
  console.log(`Found ${products.length} products\n`);

  for (const product of products) {
    console.log(`Product: ${product.id} - ${product.name}`);
    console.log(`  (Products cannot be deleted via API, but plans are deactivated)`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Cleanup complete!');
  console.log('\nNote: Products cannot be deleted via API, but all plans have been deactivated.');
  console.log('You can now run setup-paypal-plans.ts to create new plans.\n');
}

main().catch(console.error);
