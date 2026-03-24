---
disable-model-invocation: true
---

# Auth0 Integration

Runbook for setting up, configuring, and debugging Auth0 OAuth authentication for MCP apps.

## Auth0 Dashboard Setup

### 1. Create an API

In Auth0 Dashboard → Applications → APIs → **Create API**:

- **Name:** Your app name (e.g., "TASE Market MCP")
- **Identifier:** The audience URL — must match `AUTH0_AUDIENCE` env var exactly (e.g., `https://tase-market.mcp-apps.lobix.ai`)
- **Signing Algorithm:** RS256

### 2. Required API Settings

In the API's **Settings** tab:

| Setting | Value | Why |
|---------|-------|-----|
| Enable RBAC | **ON** | Required for permission-based access |
| Add Permissions in the Access Token | **ON** | Ensures scopes appear in JWT |
| Allow Skipping User Consent | **ON** | Prevents consent screen on every auth flow |

### 3. Application Access

In the API's **Machine to Machine Applications** tab:

- The application created for dynamic client registration must have **"For user access"** set to **Allow** (not "Allow via client-grant")
- This is required because Claude Desktop uses dynamic client registration (RFC 7591) — it registers itself as a new application at runtime
- If set to "Allow via client-grant" instead, the authorize flow will fail silently

## Auth0 Tenant Details

| Item | Value |
|------|-------|
| Tenant domain | `lobix-ai.us.auth0.com` |
| Custom domain | `auth.lobix.ai` |
| Google OAuth connection | `google-oauth2` (`con_j4L3TiM1gW9zTUR0`) |
| Username-Password connection | `Username-Password-Authentication` (`con_Or6jyhPr8e1nXxsQ`) |
| M2M app (Management API) | `UlUezCWZXz576VvoK6dL7nGzmDWiLsp7` |

## Dynamic Client Registration (DCR) Setup

Claude Desktop uses OIDC Dynamic Client Registration (RFC 7591) to register itself as an OAuth client at runtime. Dynamically registered clients are **third-party by default** and cannot access connections unless those connections are promoted to domain-level.

### 1. Enable OIDC DCR

In Auth0 Dashboard → Settings → Advanced → **OAuth** section:
- Set **OIDC Dynamic Application Registration** to **Enabled**

### 2. Set Default Audience

In Auth0 Dashboard → Settings → General → **API Authorization Settings**:
- Set **Default Audience** to your API identifier (e.g., `https://tase-market.mcp-apps.lobix.ai`)
- This ensures JWT tokens are issued with the correct `aud` claim even when the client doesn't explicitly request an audience

### 3. Promote Connections to Domain-Level (Critical)

Dynamically registered clients are third-party and can only use **domain-level connections**. Without this step, users will see "no connections enabled for the client" when trying to log in.

#### Get a Management API Token

1. In Auth0 Dashboard → Applications → APIs → **Auth0 Management API** → **API Explorer** tab
2. Or use the M2M app (`UlUezCWZXz576VvoK6dL7nGzmDWiLsp7`) to request a token:

```bash
curl -s -X POST "https://lobix-ai.us.auth0.com/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "UlUezCWZXz576VvoK6dL7nGzmDWiLsp7",
    "client_secret": "YOUR_CLIENT_SECRET",
    "audience": "https://lobix-ai.us.auth0.com/api/v2/",
    "grant_type": "client_credentials"
  }'
```

Required scopes on the M2M app: `read:clients`, `update:clients`, `read:connections`, `update:connections`

#### List Connections

```bash
curl -s "https://lobix-ai.us.auth0.com/api/v2/connections?fields=id,name,strategy,is_domain_connection&include_fields=true" \
  -H "Authorization: Bearer $MGMT_TOKEN"
```

#### Promote Each Connection to Domain-Level

```bash
# Google OAuth
curl -s -X PATCH "https://lobix-ai.us.auth0.com/api/v2/connections/con_j4L3TiM1gW9zTUR0" \
  -H "Authorization: Bearer $MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_domain_connection": true}'

# Username-Password
curl -s -X PATCH "https://lobix-ai.us.auth0.com/api/v2/connections/con_Or6jyhPr8e1nXxsQ" \
  -H "Authorization: Bearer $MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_domain_connection": true}'
```

#### Verify DCR Works

```bash
curl -s -X POST "https://auth.lobix.ai/oidc/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Test DCR Client",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "client_secret_post"
  }'
```

A successful response returns a `client_id` and `client_secret`. Then connect from Claude Desktop to confirm the full OAuth flow succeeds.

## Env Vars

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH0_DOMAIN` | Auth0 tenant domain (no `https://`) | `auth.lobix.ai` |
| `AUTH0_AUDIENCE` | API identifier — must match Auth0 API exactly | `https://tase-market.mcp-apps.lobix.ai` |
| `APP_URL` | Public URL of this app (used for metadata endpoints) | `https://tase-market.mcp-apps.lobix.ai` |

When `AUTH0_DOMAIN` is unset, auth is disabled entirely (local dev mode).

## Server-Side Integration

All auth code lives in `main.ts`. The transport is **stateless** (`sessionIdGenerator: undefined`) — there are no server-side sessions. The integration has five parts:

### 1. JWT Validation Middleware

```typescript
import { auth } from "express-oauth2-jwt-bearer";

const auth0Middleware = auth({
  issuerBaseURL: `https://${AUTH0_DOMAIN}`,
  audience: AUTH0_AUDIENCE,
});
```

### 2. OAuth Protected Resource Metadata (RFC 9728)

Two endpoints serve identical metadata — Claude Desktop checks both:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`

Response includes `resource` (= `AUTH0_AUDIENCE`), `authorization_servers` (= `[APP_URL]`), `scopes_supported`, `bearer_methods_supported: ["header"]` (we only accept Bearer tokens in the Authorization header), and `resource_documentation` (RFC 9728 field name).

### 3. Authorization Server Metadata Proxy

`GET /.well-known/oauth-authorization-server` proxies Auth0's OpenID configuration but rewrites `authorization_endpoint` to point to the local authorize proxy (`${APP_URL}/oauth/authorize`). It also injects two fields that Auth0's OIDC discovery omits but the MCP spec requires:

- **`code_challenge_methods_supported: ["S256"]`** — MCP clients MUST refuse to proceed without this field. Auth0 supports PKCE with S256 but doesn't advertise it in OIDC metadata. This is the most likely cause of intermittent auth failures with ChatGPT and Claude Desktop.
- **`registration_endpoint`** — Points to Auth0's DCR endpoint (`https://${AUTH0_DOMAIN}/oidc/register`). Some MCP clients need this to discover where to register dynamically.

### 4. Authorize Proxy (Critical)

`GET /oauth/authorize` does two things before redirecting to Auth0:

1. **Strips trailing slash** from `resource` param — Claude Desktop sends `resource=https://…/` but Auth0 API identifiers have no trailing slash
2. **Forces correct `audience`** — Sets `params.set("audience", AUTH0_AUDIENCE)` to prevent token reuse across multiple APIs on the same Auth0 tenant

### 5. mcpAuth Middleware

Handles the full auth flow on the `/mcp` endpoint:

- No `Authorization` header → 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="openid email profile"` (scope tells clients what to request)
- Has header → runs `auth0Middleware` → on error, returns 401 with `error="invalid_token"` and `scope` hint
- On success, transforms Auth0's `VerifyJwtResult` into MCP `AuthInfo` format:
  ```typescript
  (req as any).auth = {
    token,
    clientId: payload.azp ?? payload.sub ?? "",
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    expiresAt: payload.exp,
    extra: payload,  // full JWT payload — userId via extra.sub
  };
  ```

### 6. Extracting User ID

```typescript
const resolveUserId = (req: Request): string | null => {
  const authInfo = (req as any).auth;
  const sub = authInfo?.extra?.sub;
  if (sub && typeof sub === "string") return sub;
  return null;
};
```

The `sub` claim from Auth0 (e.g., `auth0|abc123`) is used as the `AppUser.id` in the database.

## Known Gotchas

### "No connections enabled for the client" on login

Dynamically registered clients (like Claude Desktop) are third-party by default. Third-party clients can only use **domain-level connections**. If no connections are promoted to domain-level, the Auth0 login page will show "no connections enabled for the client" — no login buttons appear at all.

**Fix:** Use the Auth0 Management API to set `is_domain_connection: true` on each connection. See the [DCR Setup](#3-promote-connections-to-domain-level-critical) section above.

### Multiple APIs on the same Auth0 tenant

When you have multiple MCP apps (e.g., rashi-commentary and tase-market) on the **same Auth0 tenant**, Claude Desktop may reuse a cached token from one API for the other. The token's `aud` claim won't match `AUTH0_AUDIENCE`, causing `express-oauth2-jwt-bearer` to reject it with an opaque "Unauthorized" error.

**Fix:** The authorize proxy forces `params.set("audience", AUTH0_AUDIENCE)` so Auth0 always issues a token with the correct audience for this specific API.

### Dynamic client registration requires "Allow" not "Allow via client-grant"

Claude Desktop dynamically registers itself as an OAuth client. In the Auth0 API's Application Access tab, the dynamically registered application must be set to **"Allow"** (For user access), not "Allow via client-grant". The latter only supports machine-to-machine flows and will cause the authorize redirect to fail.

### Trailing slash on resource parameter

Claude Desktop sends `resource=https://your-app.example.com/` (with trailing slash) in the authorize request. Auth0 API identifiers don't have trailing slashes. Without stripping it, Auth0 won't match the resource to any API.

### Token validation errors are opaque

`express-oauth2-jwt-bearer` swallows error details. The `mcpAuth` middleware now logs structured error info automatically:

- `AUTH: No Authorization header` — logged with URL and method when no Bearer token is sent
- `AUTH ERROR:` — logged with error message, code, and URL when token validation fails

## Debugging Checklist

1. **Check Auth0 Monitor → Logs** — Look for `Success Exchange` (token issued) or `Failed Exchange` events. The log detail shows which API/audience was requested.

2. **Decode the JWT** — Copy the token from the `Authorization: Bearer …` header and paste into [jwt.io](https://jwt.io). Check:
   - `aud` claim matches `AUTH0_AUDIENCE` exactly
   - `iss` matches `https://${AUTH0_DOMAIN}/`
   - Token is not expired

3. **Test the metadata endpoints** with curl:
   ```bash
   curl https://your-app.example.com/.well-known/oauth-protected-resource
   curl https://your-app.example.com/.well-known/oauth-authorization-server
   ```

4. **Test the authorize flow** — Visit the authorize URL directly in a browser:
   ```
   https://your-app.example.com/oauth/authorize?audience=YOUR_AUDIENCE&resource=YOUR_AUDIENCE
   ```
   Should redirect to Auth0's `/authorize` page.

5. **Check server logs** — Look for `AUTH:` and `AUTH ERROR:` log entries for structured diagnostics of auth failures.

6. **Check env vars** — Ensure `AUTH0_AUDIENCE` matches the API identifier in Auth0 Dashboard exactly (no trailing slash, correct protocol).
