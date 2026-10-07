import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));

const migration = spawn(process.execPath, ["migrate.mjs"], {
  cwd: scriptsDirectory,
  stdio: "inherit",
  env: process.env,
});

migration.on("error", (error) => {
  console.error("Failed to start database migrations:", error);
  process.exit(1);
});

migration.on("exit", (code, signal) => {
  if (signal || code !== 0) {
    console.error(
      `[STARTUP] Database migrations failed; TripPlanner was not started (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
    );
    process.exit(code ?? 1);
  }

  const app = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  app.on("error", (error) => {
    console.error("Failed to start TripPlanner:", error);
    process.exit(1);
  });

  app.on("exit", (appCode, appSignal) => {
    process.exit(appCode ?? 1);
  });

  const forwardSignal = (signal) => {
    if (!app.killed) app.kill(signal);
  };

  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("SIGINT", () => forwardSignal("SIGINT"));
});
