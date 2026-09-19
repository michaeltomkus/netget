import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "InterviewAI — Mock Interview Practice",
        short_name: "InterviewAI",
        description:
          "Self-practice mock interview tool: AI-generated questions, live voice answering, and graded feedback.",
        theme_color: "#7c3aed",
        // Matches the dark theme's surface color (styles.css --bg) so the
        // install/launch splash screen doesn't flash light before the
        // page's own prefers-color-scheme CSS paints for dark-mode users.
        background_color: "#08090d",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache only the built app shell (JS/CSS/HTML/icons). Deliberately
        // no runtimeCaching rules for /api or /ws — session/report data and
        // the live STT/interrupt socket must always hit the network, never
        // be served stale from a cache.
        globPatterns: ["**/*.{js,css,html,ico,svg,png}"],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  // README's setup step is `cp .env.example .env` at the repo root, not
  // per-workspace — read VITE_* vars from there instead of frontend/.env.
  envDir: "../",
});
