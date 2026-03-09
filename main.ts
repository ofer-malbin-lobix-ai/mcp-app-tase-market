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
import {
  mcpAuthClerk,
  protectedResourceHandlerClerk,
  authServerMetadataHandlerClerk,
} from "@clerk/mcp-tools/express";
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

  // OAuth metadata endpoints (public, before Clerk middleware)
  const protectedResourceHandler = protectedResourceHandlerClerk({ scopes_supported: ["email", "profile", "openid"] });
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandler);
  app.get("/.well-known/oauth-authorization-server", async (req: Request, res: Response) => {
    // Wrap Clerk's handler to:
    // 1. Inject "openid" into scopes_supported
    // 2. Rewrite registration_endpoint to our proxy (so we can PATCH openid onto new clients)
    const fakeRes = {
      json(data: Record<string, unknown>) {
        const scopes = Array.isArray(data.scopes_supported) ? data.scopes_supported as string[] : [];
        if (!scopes.includes("openid")) {
          scopes.push("openid");
        }
        data.scopes_supported = scopes;
        // Point registration to our proxy so we can add openid to newly created clients
        if (data.registration_endpoint) {
          const baseUrl = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
          data.registration_endpoint = `${baseUrl}/oauth/register`;
        }
        res.json(data);
      },
      status(code: number) { res.status(code); return fakeRes; },
      send(body: unknown) { res.send(body); return fakeRes; },
    };
    await authServerMetadataHandlerClerk(req as never, fakeRes as never);
  });

  // Proxy OAuth dynamic client registration to Clerk, then PATCH openid scope onto the new client
  app.post("/oauth/register", async (req: Request, res: Response) => {
    try {
      const clerkRegistrationUrl = "https://clerk.professorai.app/oauth/register";
      // Forward the registration request to Clerk
      const clerkRes = await fetch(clerkRegistrationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await clerkRes.json() as Record<string, unknown>;
      if (!clerkRes.ok) {
        res.status(clerkRes.status).json(data);
        return;
      }
      // PATCH the newly created client to add openid scope
      const clientId = data.client_id as string;
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      if (clientId && clerkSecretKey) {
        // Find the OAuth app by client_id (paginate — Clerk defaults to 20 per page)
        let oaAppId: string | undefined;
        let offset = 0;
        const limit = 100;
        while (!oaAppId) {
          const listRes = await fetch(`https://api.clerk.com/v1/oauth_applications?limit=${limit}&offset=${offset}`, {
            headers: { Authorization: `Bearer ${clerkSecretKey}` },
          });
          const listData = await listRes.json() as { data: Array<{ id: string; client_id: string; scopes: string }>; total_count: number };
          const oaApp = listData.data?.find((a) => a.client_id === clientId);
          if (oaApp) {
            oaAppId = oaApp.id;
            if (!oaApp.scopes.includes("openid")) {
              const patchRes = await fetch(`https://api.clerk.com/v1/oauth_applications/${oaApp.id}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${clerkSecretKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ scopes: `${oaApp.scopes} openid` }),
              });
              console.log(`[oauth/register] Patched ${oaApp.id} openid scope: ${patchRes.ok}`);
            }
          }
          offset += limit;
          if (!listData.data?.length || offset >= (listData.total_count ?? offset)) break;
        }
        if (!oaAppId) {
          console.warn(`[oauth/register] Could not find OAuth app for client_id ${clientId}`);
        }
      }
      res.status(clerkRes.status).json(data);
    } catch (err) {
      console.error("[oauth/register proxy]", err);
      res.status(500).json({ error: "Registration proxy failed" });
    }
  });

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

  // Helper to extract userId from request (works with mcpAuthClerk)
  const resolveUserId = (req: Request): string | null => {
    // Try OAuth token (set by mcpAuthClerk)
    const oauthAuth = (req as Request & { auth?: { extra?: { userId?: string } } }).auth;
    if (oauthAuth?.extra?.userId) {
      return oauthAuth.extra.userId;
    }

    // Try Clerk session (for browser requests)
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
      // No user ID - let mcpAuthClerk handle 401
      next();
      return;
    }

    const hasSubscription = await checkSubscription(userId);

    if (!hasSubscription) {
      const baseUrl = process.env.APP_URL ?? `http://localhost:${port}`;
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
    const baseUrl = process.env.APP_URL ?? `http://localhost:${port}`;
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
      await transport.handleRequest(req, res, req.body);
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

  // Protected MCP endpoint with subscription check
  app.all("/mcp", mcpAuthClerk, requireSubscription, mcpHandler);

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
