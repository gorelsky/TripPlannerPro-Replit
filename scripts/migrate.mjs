import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import dotenv from "dotenv";
import { getDatabaseConfig } from "../server/database-config.ts";

dotenv.config({ override: true });

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDirectory, "..", "migrations");
const databaseConfig = getDatabaseConfig();

const pool = new pg.Pool({
  connectionString: databaseConfig.connectionString,
  ssl: databaseConfig.ssl,
});
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} finally {
  await pool.end();
}
