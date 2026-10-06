import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Test-only Vite server for the Playwright journey. It mirrors the app's real
// plugins and alias but binds to the e2e ports and proxies `/api` to the
// isolated e2e backend, leaving the documented dev proxy (3000) untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5373,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3300" },
  },
});
