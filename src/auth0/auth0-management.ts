// Token cache
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

function getConfig() {
  // Management API requires the actual Auth0 tenant domain, not a custom domain
  const domain = process.env.AUTH0_MGMT_DOMAIN ?? process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID;
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error('Auth0 Management API credentials not configured');
  }
  return { domain, clientId, clientSecret };
}

async function getManagementToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && tokenExpiresAt > now) {
    return cachedToken;
  }

  const { domain, clientId, clientSecret } = getConfig();

  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Auth0 Management token failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in - 60) * 1000;

  return data.access_token;
}

export async function createUser(
  email: string,
  password: string,
  connection: string,
): Promise<{ user_id: string }> {
  const { domain } = getConfig();
  const token = await getManagementToken();

  const response = await fetch(
    `https://${domain}/api/v2/users`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        connection,
        email_verified: false,
      }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
    const message = (errorData.message as string) ?? `Auth0 create user failed: ${response.status}`;
    console.error(`[Auth0] Failed to create user ${email}: ${response.status}`, errorData);
    const err = new Error(message);
    (err as any).statusCode = response.status;
    (err as any).auth0Code = errorData.errorCode;
    throw err;
  }

  const data = await response.json() as { user_id: string };
  console.log(`[Auth0] Created user ${email} → ${data.user_id}`);
  return data;
}

export async function blockUser(auth0UserId: string): Promise<void> {
  let domain: string;
  try {
    ({ domain } = getConfig());
  } catch {
    console.warn('[Auth0] Management API not configured, skipping block');
    return;
  }

  const token = await getManagementToken();

  const response = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocked: true }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Auth0] Failed to block user ${auth0UserId}: ${response.status} ${errorText}`);
    throw new Error(`Auth0 block user failed: ${response.status}`);
  }

  console.log(`[Auth0] Blocked user ${auth0UserId}`);
}

export async function unblockUser(auth0UserId: string): Promise<void> {
  let domain: string;
  try {
    ({ domain } = getConfig());
  } catch {
    console.warn('[Auth0] Management API not configured, skipping unblock');
    return;
  }

  const token = await getManagementToken();

  const response = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ blocked: false }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Auth0] Failed to unblock user ${auth0UserId}: ${response.status} ${errorText}`);
    throw new Error(`Auth0 unblock user failed: ${response.status}`);
  }

  console.log(`[Auth0] Unblocked user ${auth0UserId}`);
}
