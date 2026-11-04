import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDatabaseConfig } from "../server/database-config";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("enables certificate verification for Supabase and removes sslmode override", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_TARGET = "supabase";
  process.env.DATABASE_URL = "postgresql://user:pass@db.example.test:5432/app?sslmode=require&connect_timeout=5";

  const config = getDatabaseConfig();

  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  assert.equal(new URL(config.connectionString).searchParams.get("connect_timeout"), "5");
});

test("requires a valid CA for Yandex", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_TARGET = "yandex";
  process.env.YANDEX_PG_CONNECTION_STRING = "postgresql://user:pass@db.example.test:6432/app?sslmode=require";

  assert.throws(() => getDatabaseConfig(), /YANDEX_PG_SSL_CA_FILE is required/);
});

test("rejects a missing, empty, or malformed Yandex CA", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_TARGET = "yandex";
  process.env.YANDEX_PG_HOST = "db.example.test";
  process.env.YANDEX_PG_DATABASE = "app";
  process.env.YANDEX_PG_USER = "user";
  process.env.YANDEX_PG_PASSWORD = "pass";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tripplanner-db-config-"));
  const caFile = path.join(directory, "ca.pem");
  process.env.YANDEX_PG_SSL_CA_FILE = caFile;

  fs.writeFileSync(caFile, "not a certificate");
  assert.throws(() => getDatabaseConfig(), /not a valid PEM certificate/);

  fs.writeFileSync(caFile, "");
  assert.throws(() => getDatabaseConfig(), /is empty/);
});
