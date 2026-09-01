import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const defaultProductionAssetOrigin = "https://tripplanner-sls.up.railway.app";

function getProductionAssetBase() {
  const configuredOrigin =
    process.env.PUBLIC_ASSET_ORIGIN?.trim() || defaultProductionAssetOrigin;

  return `${configuredOrigin.replace(/\/+$/, "")}/`;
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? getProductionAssetBase() : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
