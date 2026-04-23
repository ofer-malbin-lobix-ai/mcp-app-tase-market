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

export async function addAppSubscription(auth0UserId: string, appId: string, expiresAt?: string): Promise<void> {
  const { domain } = getConfig();
  const token = await getManagementToken();

  // Fetch current app_metadata
  const getResponse = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}?fields=app_metadata`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    },
  );

  if (!getResponse.ok) {
    const errorText = await getResponse.text();
    console.error(`[Auth0] Failed to get user ${auth0UserId}: ${getResponse.status} ${errorText}`);
    throw new Error(`Auth0 get user failed: ${getResponse.status}`);
  }

  const user = await getResponse.json() as { app_metadata?: { apps?: string[]; expiresAt?: Record<string, string> } };
  const apps = user.app_metadata?.apps ?? [];
  const expiresAtMap = user.app_metadata?.expiresAt ?? {};

  const updatedApps = apps.includes(appId) ? apps : [...apps, appId];
  const updatedExpiresAt = { ...expiresAtMap };
  if (expiresAt) {
    updatedExpiresAt[appId] = expiresAt;
  }

  const response = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_metadata: { apps: updatedApps, expiresAt: updatedExpiresAt } }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Auth0] Failed to add app ${appId} for user ${auth0UserId}: ${response.status} ${errorText}`);
    throw new Error(`Auth0 add app failed: ${response.status}`);
  }

  console.log(`[Auth0] Added app ${appId} for user ${auth0UserId}${expiresAt ? ` (expires: ${expiresAt})` : ''}`);
}

export async function removeAppSubscription(auth0UserId: string, appId: string): Promise<void> {
  const { domain } = getConfig();
  const token = await getManagementToken();

  // Fetch current app_metadata
  const getResponse = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}?fields=app_metadata`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    },
  );

  if (!getResponse.ok) {
    const errorText = await getResponse.text();
    console.error(`[Auth0] Failed to get user ${auth0UserId}: ${getResponse.status} ${errorText}`);
    throw new Error(`Auth0 get user failed: ${getResponse.status}`);
  }

  const user = await getResponse.json() as { app_metadata?: { apps?: string[]; expiresAt?: Record<string, string> } };
  const apps = user.app_metadata?.apps ?? [];
  const expiresAtMap = user.app_metadata?.expiresAt ?? {};
  const filtered = apps.filter((a: string) => a !== appId);

  if (filtered.length === apps.length) {
    console.log(`[Auth0] User ${auth0UserId} doesn't have app ${appId}`);
    return;
  }

  const { [appId]: _, ...cleanedExpiresAt } = expiresAtMap;

  const response = await fetch(
    `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_metadata: { apps: filtered, expiresAt: cleanedExpiresAt } }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Auth0] Failed to remove app ${appId} for user ${auth0UserId}: ${response.status} ${errorText}`);
    throw new Error(`Auth0 remove app failed: ${response.status}`);
  }

  console.log(`[Auth0] Removed app ${appId} for user ${auth0UserId}`);
}
