import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Every test mocks its own I/O (Prisma/store, Clerk, Anthropic, Stripe)
    // — none of this suite talks to a real database, network, or external
    // API, so it needs no .env and runs the same in CI as locally.
  },
});
