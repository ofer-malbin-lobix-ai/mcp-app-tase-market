/**
 * Entry point for running the MCP server.
 * Run with: npm run serve
 * Or: node dist/index.js [--stdio]
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { auth } from "express-oauth2-jwt-bearer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "./server.js";
import type { TaseDataProviders } from "./src/types.js";
import { createSubscriptionRouter } from "./src/paypal/subscription-routes.js";
import { checkSubscription } from "./src/paypal/subscription-check.js";
import { generateSubscribeToken } from "./src/paypal/subscribe-token.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { createFetchEndOfDayFromTaseDataHubRouter } from "./src/tase-data-hub/fetch-end-of-day-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { createFetchSymbolsFromTaseDataHubRouter } from "./src/tase-data-hub/fetch-symbols-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { createFetchIntradayFromTaseDataHubRouter } from "./src/tase-data-hub/fetch-intraday-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { createFetchLastUpdateFromTaseDataHubRouter } from "./src/tase-data-hub/fetch-last-update-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { dbProviders } from "./src/db/db-api.js";

const __main_dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_VERSION = JSON.parse(readFileSync(path.join(__main_dirname, "dist", "widget-version.json"), "utf-8")).version;

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  createServer: (options: { subscribeUrl?: string; providers: TaseDataProviders }) => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Trust proxy (Railway, Cloudflare tunnel) for correct protocol in OAuth metadata
  app.set("trust proxy", 1);

  // CORS with WWW-Authenticate header exposed for OAuth
  app.use(cors({ exposedHeaders: ["WWW-Authenticate"] }));

  // Raw body parser for PayPal webhooks (must be before json parser)
  app.use("/api/paypal/webhook", express.raw({ type: "application/json" }));

  // JSON body parser for other routes
  app.use(express.json());

  // Health check endpoint for Railway
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // OpenAI domain verification for ChatGPT app submission
  app.get("/.well-known/openai-apps-challenge", (_req: Request, res: Response) => {
    const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    if (!token) {
      res.status(404).send("Not configured");
      return;
    }
    res.type("text/plain").send(token);
  });

  const baseUrl = process.env.APP_URL ?? `http://localhost:${port}`;

  // Auth0 configuration
  const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
  const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE ?? baseUrl;

  // Auth0 JWT validation middleware
  const auth0Middleware = AUTH0_DOMAIN
    ? auth({
        issuerBaseURL: `https://${AUTH0_DOMAIN}`,
        audience: AUTH0_AUDIENCE,
      })
    : undefined;

  // OAuth Protected Resource Metadata (RFC 9728)
  // resource must match Auth0 API identifier (audience) so tokens are issued for the correct API
  const protectedResourceHandler = (_req: Request, res: Response) => {
    res.json({
      resource: AUTH0_AUDIENCE,
      authorization_servers: AUTH0_DOMAIN ? [`https://${AUTH0_DOMAIN}`] : [],
      scopes_supported: ["openid", "email", "profile"],
      service_documentation: baseUrl,
    });
  };
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandler);

  // Apply Clerk middleware for all requests
  app.use(clerkMiddleware());

  // Mount subscription routes (requires Clerk auth)
  app.use(createSubscriptionRouter());

  // Mount fetch-end-of-day-from-tase-data-hub route (backend API, no auth — callable by cron or direct URL)
  app.use(createFetchEndOfDayFromTaseDataHubRouter());

  // Mount fetch-symbols-from-tase-data-hub route (backend API, no auth — upserts TaseSymbol metadata)
  app.use(createFetchSymbolsFromTaseDataHubRouter());

  // Mount fetch-intraday-from-tase-data-hub route (backend API, no auth — pass-through to TASE Data Hub)
  app.use(createFetchIntradayFromTaseDataHubRouter());

  // Mount fetch-last-update-from-tase-data-hub route (backend API, no auth — pass-through to TASE Data Hub)
  app.use(createFetchLastUpdateFromTaseDataHubRouter());

  // Namespace for Auth0 custom claims
  const AUTH0_CLAIM_NAMESPACE = "https://tase-market.mcp-apps.lobix.ai";

  // Helper to extract userId from request (Auth0 JWT or Clerk session)
  const resolveUserId = (req: Request): string | null => {
    // Try Auth0 JWT (transformed to MCP AuthInfo) — Clerk userId is in extra (payload) custom claim
    const authInfo = (req as any).auth as { extra?: Record<string, unknown> } | undefined;
    const clerkUserId = authInfo?.extra?.[`${AUTH0_CLAIM_NAMESPACE}/clerk_user_id`];
    if (clerkUserId && typeof clerkUserId === "string") {
      return clerkUserId;
    }

    // Fallback: Clerk session (for browser requests — subscribe page, etc.)
    const clerkAuth = getAuth(req);
    if (clerkAuth?.userId) {
      return clerkAuth.userId;
    }

    return null;
  };

  // Subscription check middleware - only checks on tools/call requests
  const requireSubscription = async (req: Request, res: Response, next: NextFunction) => {
    // Check if this is a tools/call request (MCP JSON-RPC)
    const body = req.body as { method?: string; id?: string | number } | undefined;
    const method = body?.method;

    // Only require subscription for tool calls, not for initialize/list/etc.
    if (method !== "tools/call") {
      next();
      return;
    }

    const userId = resolveUserId(req);

    if (!userId) {
      // No user ID - let auth middleware handle 401
      next();
      return;
    }

    const hasSubscription = await checkSubscription(userId);

    if (!hasSubscription) {
      const token = generateSubscribeToken(userId);
      const subscribeUrl = `${baseUrl}/subscribe?token=${token}`;

      res.status(200).json({
        jsonrpc: "2.0",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ subscribeUrl, needsSubscription: true }),
            },
          ],
          _meta: {
            ui: {
              resourceUri: `ui://tase-end-of-day/tase-market-settings-widget-ver-${WIDGET_VERSION}.html`,
            },
          },
        },
        id: body?.id ?? null,
      });
      return;
    }

    next();
  };

  // MCP endpoint handler
  const mcpHandler = async (req: Request, res: Response) => {
    const userId = resolveUserId(req);
    let subscribeUrl = `${baseUrl}/subscribe`;
    if (userId) {
      const token = generateSubscribeToken(userId);
      subscribeUrl += `?token=${token}`;
    }
    const server = createServer({ subscribeUrl, providers: dbProviders });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      // Cast needed: express-oauth2-jwt-bearer augments req.auth type globally,
      // but we transform it to MCP AuthInfo in mcpAuth middleware at runtime
      await transport.handleRequest(req as any, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  // Auth0 authentication middleware for MCP endpoint
  // Validates the JWT and transforms req.auth into MCP AuthInfo format
  const mcpAuth = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      const prmUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
      res.status(401).set({
        "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}"`,
      }).json({ error: "Unauthorized" });
      return;
    }
    if (auth0Middleware) {
      // Validate JWT with Auth0, then transform to MCP AuthInfo format
      auth0Middleware(req, res, (err?: unknown) => {
        if (err) { next(err); return; }
        // Transform Auth0's VerifyJwtResult into MCP's AuthInfo
        const auth0Result = (req as any).auth;
        if (auth0Result?.payload) {
          const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
          (req as any).auth = {
            token,
            clientId: auth0Result.payload.azp ?? auth0Result.payload.sub ?? "",
            scopes: (auth0Result.payload.scope ?? "").split(" ").filter(Boolean),
            expiresAt: auth0Result.payload.exp,
            extra: auth0Result.payload,
          };
        }
        next();
      });
    } else {
      // No Auth0 configured — pass through (stdio/local dev)
      next();
    }
  };

  // Protected MCP endpoint with subscription check
  app.all("/mcp", mcpAuth, requireSubscription, mcpHandler);

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.error(`TASE End of Day MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.error("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Starts an MCP server with stdio transport.
 */
export async function startStdioServer(
  createServer: (options: { providers: TaseDataProviders }) => McpServer,
): Promise<void> {
  await createServer({ providers: dbProviders }).connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
