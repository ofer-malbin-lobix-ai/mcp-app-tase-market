import "./env.js";

/**
 * Entry point for running the MCP server.
 * Run with: npm run serve
 * Or: node dist/index.js [--stdio]
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { auth } from "express-oauth2-jwt-bearer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "./server.js";
import type { TaseDataProviders } from "./src/types.js";
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

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  createServer: (options: { providers: TaseDataProviders; domain?: string }) => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Trust proxy (Railway, Cloudflare tunnel) for correct protocol in OAuth metadata
  app.set("trust proxy", 1);

  // CORS with WWW-Authenticate header exposed for OAuth
  app.use(cors({ exposedHeaders: ["WWW-Authenticate"] }));

  // JSON body parser for MCP endpoint
  app.use(express.json());

  // Serve static files (favicon, etc.)
  app.use(express.static(path.join(__main_dirname, "public")));

  // Serve favicon.svg as favicon.ico fallback
  app.get("/favicon.ico", (_req: Request, res: Response) => {
    res.sendFile(path.join(__main_dirname, "public", "favicon.svg"));
  });

  // Health check endpoint for Railway
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // Landing page
  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TASE Market</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
    .card { text-align: center; padding: 2rem; max-width: 480px; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #666; margin-top: 0.5rem; line-height: 1.6; }
    .links { margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    a { color: #3b82f6; text-decoration: none; padding: 0.5rem 1rem; border: 1px solid #3b82f6; border-radius: 8px; font-size: 0.9rem; }
    a:hover { background: #3b82f6; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>TASE Market</h1>
    <p>Tel Aviv Stock Exchange market data for AI assistants.</p>
    <div class="links">
      <a href="https://www.lobix.ai">www.lobix.ai</a>
    </div>
  </div>
</body>
</html>`);
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
      authorization_servers: AUTH0_DOMAIN ? [baseUrl] : [],
      scopes_supported: ["openid", "email", "profile"],
      bearer_methods_supported: ["header"],
      resource_documentation: baseUrl,
    });
  };
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandler);

  // Proxy Auth0 authorization server metadata for MCP clients that fetch it from the resource server
  if (AUTH0_DOMAIN) {
    app.get("/.well-known/oauth-authorization-server", async (_req: Request, res: Response) => {
      try {
        const response = await fetch(`https://${AUTH0_DOMAIN}/.well-known/openid-configuration`);
        const metadata = await response.json() as Record<string, unknown>;
        // Rewrite authorization_endpoint to our proxy so we can normalize the resource param
        metadata.authorization_endpoint = `${baseUrl}/oauth/authorize`;
        if (!metadata.code_challenge_methods_supported) {
          metadata.code_challenge_methods_supported = ["S256"];
        }
        if (!metadata.registration_endpoint) {
          metadata.registration_endpoint = `https://${AUTH0_DOMAIN}/oidc/register`;
        }
        res.json(metadata);
      } catch (error) {
        console.error("Failed to fetch Auth0 metadata:", error);
        res.status(502).json({ error: "Failed to fetch authorization server metadata" });
      }
    });

    // Authorize proxy: strip trailing slash from resource param before redirecting to Auth0
    app.get("/oauth/authorize", (req: Request, res: Response) => {
      const params = new URLSearchParams(req.query as Record<string, string>);
      const resource = params.get("resource");
      if (resource) {
        params.set("resource", resource.replace(/\/+$/, ""));
      }
      // Force the correct audience for this API (prevents token reuse across APIs on same Auth0 tenant)
      params.set("audience", AUTH0_AUDIENCE);
      res.redirect(`https://${AUTH0_DOMAIN}/authorize?${params.toString()}`);
    });
  }

  // Redirect legacy commerce URLs to lobix.ai (signup/subscription now live there)
  const redirectToSite = (_req: Request, res: Response) => {
    res.redirect(302, "https://www.lobix.ai");
  };
  app.get("/signup", redirectToSite);
  app.get("/subscribe", redirectToSite);
  app.get("/paypal/result", redirectToSite);

  // Mount fetch-end-of-day-from-tase-data-hub route (backend API, no auth — callable by cron or direct URL)
  app.use(createFetchEndOfDayFromTaseDataHubRouter());

  // Mount fetch-symbols-from-tase-data-hub route (backend API, no auth — upserts TaseSymbol metadata)
  app.use(createFetchSymbolsFromTaseDataHubRouter());

  // Mount fetch-intraday-from-tase-data-hub route (backend API, no auth — pass-through to TASE Data Hub)
  app.use(createFetchIntradayFromTaseDataHubRouter());

  // Mount fetch-last-update-from-tase-data-hub route (backend API, no auth — pass-through to TASE Data Hub)
  app.use(createFetchLastUpdateFromTaseDataHubRouter());

  // MCP endpoint handler
  const mcpHandler = async (req: Request, res: Response) => {
    // Detect host to set correct widget domain format
    // ChatGPT sends "openai-mcp/1.0.0" user-agent; others (Claude Desktop) get no domain
    const isChatGPT = req.headers["user-agent"]?.includes("openai-mcp");
    const domain = isChatGPT ? "tase-market-mcp-apps-lobix-ai.oaiusercontent.com" : undefined;
    const server = createServer({ providers: dbProviders, domain });
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
      console.warn("AUTH: No Authorization header", { url: req.url, method: req.method, sessionId: req.headers["mcp-session-id"] });
      res.status(401).set({
        "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}", scope="openid email profile"`,
      }).json({ error: "Unauthorized" });
      return;
    }
    if (auth0Middleware) {
      // Validate JWT with Auth0, then transform to MCP AuthInfo format
      auth0Middleware(req, res, (err?: unknown) => {
        if (err) {
          // Invalid token — return 401 with PRM to trigger re-auth
          const prmUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
          console.error("AUTH ERROR:", { message: (err as Error)?.message, code: (err as any)?.code, url: req.url, sessionId: req.headers["mcp-session-id"] });
          if (!res.headersSent) {
            res.status(401).set({
              "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}", error="invalid_token", scope="openid email profile"`,
            }).json({ error: "Invalid token" });
          }
          return;
        }
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

        // Check per-app access via custom JWT claim
        const apps = auth0Result?.payload?.["https://auth.lobix.ai/apps"] as string[] | undefined;
        if (!apps || !apps.includes("tase-market")) {
          res.status(403).json({ error: "Access not granted for this app" });
          return;
        }

        next();
      });
    } else {
      // No Auth0 configured — pass through (stdio/local dev)
      next();
    }
  };

  // Protected MCP endpoint
  app.post("/mcp", mcpAuth, mcpHandler);
  app.get("/mcp", mcpAuth, mcpHandler);

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
