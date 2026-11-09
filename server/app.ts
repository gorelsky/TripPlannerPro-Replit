import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createHmac, timingSafeEqual } from "node:crypto";

import { pool } from "./db";
import { registerRoutes } from "./routes";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();
declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Railway terminates TLS at its proxy before forwarding requests to the app.
app.set("trust proxy", true);
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Session middleware
const PostgresSessionStore = connectPgSimple(session);
export const sessionStore = new PostgresSessionStore({
  pool,
  tableName: "trip_planner_sessions",
  createTableIfMissing: true,
});

// Create the session table before the first request. This is important for
// Yandex Managed PostgreSQL, where the store's lazy table creation can race
// with the first OAuth session write or fail without a useful request error.
async function ensureSessionStoreTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_planner_sessions (
      sid varchar(255) NOT NULL PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS trip_planner_sessions_expire_idx
    ON trip_planner_sessions (expire)
  `);
}
const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? undefined : "dev-secret-key");
if (!sessionSecret || (process.env.NODE_ENV === "production" && sessionSecret.length < 32)) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters in production");
}

app.use(session({
  secret: sessionSecret,
  proxy: process.env.NODE_ENV === "production",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  name: "connect.sid",
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    // The OAuth callback is a top-level GET back to this site. Lax keeps the
    // session cookie available during that return without relying on
    // cross-site cookie exceptions in the browser.
    // The callback is a top-level GET navigation back to this site. Lax is
    // broadly supported and avoids browsers rejecting a cross-site cookie.
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    path: "/",
  },
}));

// Yandex Serverless Containers can occasionally drop the PostgreSQL session
// cookie between two sequential requests. Keep a signed, short-lived user-id
// cookie as a fallback so a successful login is not immediately lost.
const fallbackAuthCookie = "trip_planner_auth";
const authSigningSecret = sessionSecret as string;
function signFallbackAuth(userId: string): string {
  const payload = Buffer.from(userId, "utf8").toString("base64url");
  const signature = createHmac("sha256", authSigningSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyFallbackAuth(value: string): string | undefined {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return undefined;
  const expected = createHmac("sha256", authSigningSecret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return undefined;
  try {
    const userId = Buffer.from(payload, "base64url").toString("utf8");
    return userId || undefined;
  } catch {
    return undefined;
  }
}

function getCookieValue(header: string | undefined, name: string): string | undefined {
  const item = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
}

function appendFallbackAuthCookie(res: Response, userId: string) {
  res.append("Set-Cookie", `${fallbackAuthCookie}=${encodeURIComponent(signFallbackAuth(userId))}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

function clearFallbackAuthCookie(res: Response) {
  res.append("Set-Cookie", `${fallbackAuthCookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    const fallbackUserId = getCookieValue(req.headers.cookie, fallbackAuthCookie);
    if (fallbackUserId && verifyFallbackAuth(fallbackUserId)) req.session.userId = fallbackUserId;
  }
  res.locals.setFallbackAuthCookie = appendFallbackAuthCookie;
  res.locals.clearFallbackAuthCookie = clearFallbackAuthCookie;
  next();
});

// Type augmentation for session user
declare module 'express-session' {
  interface SessionData {
    userId: string;
    loginSessionId?: string;
    oidcState?: string;
    oidcNonce?: string;
    oidcCodeVerifier?: string;
    oidcReturnTo?: string;
  }
}

// Supports the local preview environment without weakening production sessions.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "production") return next();
  const sessionId = req.headers['x-session-id'] as string;
  if (sessionId && !req.session.userId) {
    sessionStore.get(sessionId, (err, session) => {
      if (!err && session && (session as any).userId) {
        req.session.userId = (session as any).userId;
        // Re-save the stored session so future lookups keep finding it
        sessionStore.set(sessionId, session, (setErr) => {
          if (setErr) console.error('[SESSION] Error re-saving:', setErr);
          next();
        });
      } else {
        next();
      }
    });
  } else {
    next();
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  await ensureSessionStoreTable();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request failed");
    if (status >= 500) console.error("[ERROR] Unhandled request error", err);
    res.status(status).json({ message });
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  const port = parseInt(process.env.PORT || "5000", 10);

  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
}

