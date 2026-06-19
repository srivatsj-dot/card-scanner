import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Express server during development.
export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root, alongside GEMINI_API_KEY, so all config lives
  // in one place (Vite only exposes vars prefixed with VITE_).
  envDir: "..",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
