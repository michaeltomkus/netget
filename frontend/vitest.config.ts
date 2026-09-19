import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Deliberately separate from vite.config.ts rather than merging it — the
// PWA plugin there has nothing to do with running tests, and keeping this
// minimal avoids test runs picking up service-worker/manifest generation.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
