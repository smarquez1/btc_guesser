import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  test: {
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/client/test/setup.ts"],
        },
      },
    ],
  },
});
