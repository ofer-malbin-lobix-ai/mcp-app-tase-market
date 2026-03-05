import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Required for Node.js environments (non-browser) to establish WebSocket connections
neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env["DATABASE_URL"] });

export const prisma = new PrismaClient({ adapter });
