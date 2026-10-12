import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), "innostar-demo-vite-cache"),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
});
