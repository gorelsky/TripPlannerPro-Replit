import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

dotenv.config({ override: true, quiet: true });

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  fields.push(value.trim());
  return fields;
}

function routeKey(route) {
  return [route.path, route.distance, route.cities.join("\u001f"), route.kilometers].join("\u001e");
}

function normalizeRow(line) {
  let fields = parseCsvLine(line);
  if (fields.length === 1) {
    fields = parseCsvLine(fields[0]);
  }
  if (fields.length !== 4) return null;

  const [rawPath, rawDistance, rawCities, rawKilometers] = fields;
  const kilometers = rawKilometers.replace(/[^0-9]/g, "");
  const cities = rawCities
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean);
  const pathValue = rawPath.trim();
  const distanceValue = rawDistance.trim() || (kilometers ? `${kilometers} км` : "");

  if (!pathValue || !kilometers || cities.length < 2) return null;
  return {
    path: pathValue,
    distance: distanceValue,
    cities,
    kilometers,
  };
}

const dryRun = process.argv.includes("--dry-run");
const sourceArgument = process.argv.slice(2).find((argument) => argument !== "--dry-run");
const sourcePath = path.resolve(process.cwd(), sourceArgument || "маршруты.csv");
const lines = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
const header = parseCsvLine(lines.shift() || "");

if (header.join(",") !== "path,distance,cities,kilometers") {
  throw new Error("Expected columns: path,distance,cities,kilometers");
}

const invalidLines = [];
const routes = [];
for (const [index, line] of lines.entries()) {
  if (!line.trim()) continue;
  const route = normalizeRow(line);
  if (route) routes.push(route);
  else invalidLines.push(index + 2);
}

const uniqueRoutes = [...new Map(routes.map((route) => [routeKey(route), route])).values()];
if (dryRun) {
  console.log(`Parsed routes: ${routes.length}`);
  console.log(`Unique routes: ${uniqueRoutes.length}`);
  console.log(`Invalid rows: ${invalidLines.length}`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const existing = await client.query(
    "SELECT path, distance, cities, kilometers FROM trip_planner_routes",
  );
  const existingKeys = new Set(existing.rows.map(routeKey));
  let inserted = 0;

  for (const route of uniqueRoutes) {
    if (existingKeys.has(routeKey(route))) continue;
    await client.query(
      `INSERT INTO trip_planner_routes (id, path, distance, cities, kilometers, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), route.path, route.distance, route.cities, route.kilometers],
    );
    inserted += 1;
  }

  await client.query("COMMIT");
  console.log(`Inserted routes: ${inserted}`);
  console.log(`Skipped existing routes: ${uniqueRoutes.length - inserted}`);
  console.log(`Skipped invalid rows: ${invalidLines.length}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
