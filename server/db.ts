import dotenv from "dotenv";

dotenv.config({ override: true });

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getDatabaseConfig } from "./database-config";

const { Pool } = pg;

const databaseConfig = getDatabaseConfig();

export const pool = new Pool({
  connectionString: databaseConfig.connectionString,
  ssl: databaseConfig.ssl,
});

// A transient idle-client error must not terminate the whole Serverless
// Container. Request handlers already report database failures to the caller;
// this listener keeps the process alive so the next request can use a fresh
// PostgreSQL connection.
pool.on("error", (error) => {
  console.error("[DB] PostgreSQL pool error:", error);
});

// Express 4 does not automatically consume rejected async route handlers.
// Keep a transient rejected promise from taking down the container before the
// route can return its normal error response.
process.on("unhandledRejection", (error) => {
  console.error("[PROCESS] Unhandled promise rejection:", error);
});

console.log(`[DB] PostgreSQL target: ${databaseConfig.target}`);

export const db = drizzle(pool);

