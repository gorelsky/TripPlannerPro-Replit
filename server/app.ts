import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

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
const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? undefined : "dev-secret-key");
if (!sessionSecret || (process.env.NODE_ENV === "production" && sessionSecret.length < 32)) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters in production");
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  name: "connect.sid",
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    path: "/",
  },
}));

// Type augmentation for session user
declare module 'express-session' {
  interface SessionData {
    userId: string;
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
