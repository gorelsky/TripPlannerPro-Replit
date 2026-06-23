import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Create postgres pool
export const pool = new Pool({
  connectionString,
});

// Create drizzle instance
export const db = drizzle(pool);
