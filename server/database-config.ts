import fs from "node:fs";
import path from "node:path";

export type DatabaseTarget = "supabase" | "yandex";

export type DatabaseConfig = {
  target: DatabaseTarget;
  connectionString: string;
  ssl: { rejectUnauthorized: boolean; ca?: string };
};

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required when DATABASE_TARGET=yandex`);
  }
  return normalized;
}

function readYandexCaFile(fileName: string | undefined): string | undefined {
  if (!fileName?.trim()) return undefined;
  const filePath = path.resolve(fileName.trim());
  if (!fs.existsSync(filePath)) {
    throw new Error(`YANDEX_PG_SSL_CA_FILE was not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function getYandexConnectionString(): string {
  const configuredUrl = process.env.YANDEX_PG_CONNECTION_STRING?.trim();
  if (configuredUrl) return configuredUrl;

  const host = required("YANDEX_PG_HOST", process.env.YANDEX_PG_HOST);
  const port = process.env.YANDEX_PG_PORT?.trim() || "6432";
  const database = required("YANDEX_PG_DATABASE", process.env.YANDEX_PG_DATABASE);
  const user = encodeURIComponent(required("YANDEX_PG_USER", process.env.YANDEX_PG_USER));
  const password = encodeURIComponent(required("YANDEX_PG_PASSWORD", process.env.YANDEX_PG_PASSWORD));

  return `postgresql://${user}:${password}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
}

export function getDatabaseConfig(): DatabaseConfig {
  const target = (process.env.DATABASE_TARGET?.trim().toLowerCase() || "supabase") as DatabaseTarget;
  if (target !== "supabase" && target !== "yandex") {
    throw new Error(`Unsupported DATABASE_TARGET: ${target}. Use supabase or yandex.`);
  }

  if (target === "yandex") {
    const ca = readYandexCaFile(process.env.YANDEX_PG_SSL_CA_FILE);
    return {
      target,
      connectionString: getYandexConnectionString(),
      ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false },
    };
  }

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL or SUPABASE_DATABASE_URL is required when DATABASE_TARGET=supabase");
  }

  return {
    target,
    connectionString,
    ssl: { rejectUnauthorized: false },
  };
}
