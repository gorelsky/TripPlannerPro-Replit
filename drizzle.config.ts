import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { getDatabaseConfig } from "./server/database-config";

dotenv.config({ override: true });

const databaseConfig = process.env.DRIZZLE_DATABASE_URL?.trim()
  ? {
      target: "supabase" as const,
      connectionString: process.env.DRIZZLE_DATABASE_URL.trim(),
      ssl: { rejectUnauthorized: false },
    }
  : getDatabaseConfig();

const parsedDatabaseUrl = new URL(databaseConfig.connectionString);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: parsedDatabaseUrl.hostname,
    port: Number(parsedDatabaseUrl.port || 5432),
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: parsedDatabaseUrl.pathname.replace(/^\//, ""),
    ssl: "require",
  },
});
