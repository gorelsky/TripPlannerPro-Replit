import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

dotenv.config({ override: true });

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDirectory, "..", "migrations");
const target = (process.env.DATABASE_TARGET || "supabase").trim().toLowerCase();
let connectionString;
let ssl = { rejectUnauthorized: false };

if (target === "yandex") {
  const configuredUrl = process.env.YANDEX_PG_CONNECTION_STRING?.trim();
  if (configuredUrl) {
    connectionString = configuredUrl;
  } else {
    const host = process.env.YANDEX_PG_HOST?.trim();
    const database = process.env.YANDEX_PG_DATABASE?.trim();
    const user = process.env.YANDEX_PG_USER?.trim();
    const password = process.env.YANDEX_PG_PASSWORD;
    if (!host || !database || !user || !password) {
      throw new Error("YANDEX_PG_HOST, YANDEX_PG_DATABASE, YANDEX_PG_USER and YANDEX_PG_PASSWORD are required");
    }
    const port = process.env.YANDEX_PG_PORT?.trim() || "6432";
    connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
  }

  const caFile = process.env.YANDEX_PG_SSL_CA_FILE?.trim();
  if (caFile) {
    const caPath = path.resolve(caFile);
    if (!fs.existsSync(caPath)) throw new Error(`YANDEX_PG_SSL_CA_FILE was not found: ${caPath}`);
    ssl = { rejectUnauthorized: true, ca: fs.readFileSync(caPath, "utf8") };
  }
} else if (target === "supabase") {
  connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
} else {
  throw new Error("DATABASE_TARGET must be supabase or yandex");
}

if (!connectionString) throw new Error("A database connection is required");

const pool = new pg.Pool({
  connectionString,
  ssl,
});
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} finally {
  await pool.end();
}
