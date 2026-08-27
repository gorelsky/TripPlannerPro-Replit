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

// Trust proxy for correct cookie handling behind Replit's reverse proxy
app.set("trust proxy", true);

// Session middleware
const PostgresSessionStore = connectPgSimple(session);
export const sessionStore = new PostgresSessionStore({
  pool,
  tableName: "trip_planner_sessions",
  createTableIfMissing: true,
});
const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? undefined : "dev-secret-key");
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be configured in production");
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  name: "connect.sid",
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? "none" : "lax",
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

// Middleware to support session via X-Session-ID header for iframe environments
// where cookies may be blocked by third-party cookie policies (Replit preview)
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Debug session info for export endpoint
  if (path.includes("admin/trips-report")) {
    console.log(`[SESSION-DEBUG] Path: ${path}`);
    console.log(`[SESSION-DEBUG] Headers: ${JSON.stringify(req.headers)}`);
    console.log(`[SESSION-DEBUG] Cookies: ${JSON.stringify(req.cookies)}`);
    console.log(`[SESSION-DEBUG] session.id: ${req.sessionID}`);
    console.log(`[SESSION-DEBUG] session.userId: ${req.session?.userId}`);
  }

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "...";
      }

      log(logLine);
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
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const isWindows = process.platform === "win32";

  server.listen(
    {
      port,
      host,
      ...(isWindows ? {} : { reusePort: true }),
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
}
