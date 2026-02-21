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
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "./server.js";
import { createSubscriptionRouter } from "./src/paypal/subscription-routes.js";
import { checkSubscription } from "./src/paypal/subscription-check.js";
import { generateSubscribeToken } from "./src/paypal/subscribe-token.js";

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  createServer: () => McpServer,
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

  // OAuth metadata endpoints (public, before Clerk middleware)
  const protectedResourceHandler = protectedResourceHandlerClerk({ scopes_supported: ["email", "profile"] });
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandler);
  app.get("/.well-known/oauth-authorization-server", authServerMetadataHandlerClerk);

  // Apply Clerk middleware for all requests
  app.use(clerkMiddleware());

  // Mount subscription routes (requires Clerk auth)
  app.use(createSubscriptionRouter());

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
        error: {
          code: -32002,
          message: `Subscription required. Please visit ${subscribeUrl} to subscribe.`,
          data: {
            subscribeUrl,
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
    const server = createServer();
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
  createServer: () => McpServer,
): Promise<void> {
  await createServer().connect(new StdioServerTransport());
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
