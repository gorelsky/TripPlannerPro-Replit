import fs from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";

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

function readCaFile(fileName: string | undefined): string {
  if (!fileName?.trim()) {
    throw new Error(
      "YANDEX_PG_SSL_CA_FILE is required for DATABASE_TARGET=yandex; provide the path to the Yandex Managed PostgreSQL CA certificate",
    );
  }
  const filePath = path.resolve(fileName.trim());
  if (!fs.existsSync(filePath)) {
    throw new Error(`YANDEX_PG_SSL_CA_FILE was not found: ${filePath}`);
  }
  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`YANDEX_PG_SSL_CA_FILE is not a file: ${filePath}`);
  }
  const ca = fs.readFileSync(filePath, "utf8").trim();
  if (!ca) {
    throw new Error(`YANDEX_PG_SSL_CA_FILE is empty: ${filePath}`);
  }
  try {
    new X509Certificate(ca);
  } catch {
    throw new Error(`YANDEX_PG_SSL_CA_FILE is not a valid PEM certificate: ${filePath}`);
  }
  return ca;
}

function removeSslParameters(connectionString: string): string {
  const parsed = new URL(connectionString);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    parsed.searchParams.delete(parameter);
  }
  return parsed.toString();
}

function getYandexConnectionString(): string {
  const configuredUrl = process.env.YANDEX_PG_CONNECTION_STRING?.trim();
  if (configuredUrl) return configuredUrl;

  const host = required("YANDEX_PG_HOST", process.env.YANDEX_PG_HOST);
  const port = process.env.YANDEX_PG_PORT?.trim() || "6432";
  const database = required("YANDEX_PG_DATABASE", process.env.YANDEX_PG_DATABASE);
  const user = encodeURIComponent(required("YANDEX_PG_USER", process.env.YANDEX_PG_USER));
  const password = encodeURIComponent(required("YANDEX_PG_PASSWORD", process.env.YANDEX_PG_PASSWORD));

  // TLS is configured explicitly through the `ssl` option below. Keeping
  // sslmode=require in the URL makes newer node-postgres versions reinterpret
  // the connection as certificate-verified and reject Yandex's CA chain.
  return `postgresql://${user}:${password}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function getDatabaseConfig(): DatabaseConfig {
  const configuredTarget = process.env.DATABASE_TARGET?.trim().toLowerCase();
  if (!configuredTarget && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_TARGET must be explicitly set to yandex or supabase in production");
  }

  const target = (configuredTarget || "supabase") as DatabaseTarget;
  if (target !== "supabase" && target !== "yandex") {
    throw new Error(`Unsupported DATABASE_TARGET: ${target}. Use supabase or yandex.`);
  }

  if (target === "yandex") {
    const ca = readCaFile(process.env.YANDEX_PG_SSL_CA_FILE);
    return {
      target,
      connectionString: removeSslParameters(getYandexConnectionString()),
      ssl: { rejectUnauthorized: true, ca },
    };
  }

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL or SUPABASE_DATABASE_URL is required when DATABASE_TARGET=supabase");
  }

  return {
    target,
    connectionString: removeSslParameters(connectionString.trim()),
    ssl: { rejectUnauthorized: true },
  };
}
