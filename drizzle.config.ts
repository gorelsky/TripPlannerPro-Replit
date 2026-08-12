import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ override: true });

const databaseUrl = process.env.DRIZZLE_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DRIZZLE_DATABASE_URL or DATABASE_URL is required");
}

const parsedDatabaseUrl = new URL(databaseUrl);

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
