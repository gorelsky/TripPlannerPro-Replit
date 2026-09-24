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

console.log(`[DB] PostgreSQL target: ${databaseConfig.target}`);

export const db = drizzle(pool);
