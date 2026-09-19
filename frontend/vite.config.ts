import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import brandConfigFile from "../brand.config.json";

// Single source of truth for the app's name/tagline/description — see
// src/config/brand.ts. Read here too (a plain Node ESM JSON import, since
// this file itself runs under Node/Vite's own config loader) so the PWA
// manifest and index.html's static <title>/meta tags stay in sync with it
// without duplicating the strings.
const brand = (brandConfigFile as { defaultVariant: string; variants: Record<string, { name: string; description: string }> })
  .variants[brandConfigFile.defaultVariant];

// index.html can't read the JSON import React components use (it's not
// JS), so its %BRAND_NAME%/%BRAND_DESCRIPTION% placeholders are resolved
// here at build/dev time instead.
function brandHtmlPlugin(): Plugin {
  return {
    name: "brand-html",
    transformIndexHtml(html) {
      return html.replace(/%BRAND_NAME%/g, brand.name).replace(/%BRAND_DESCRIPTION%/g, brand.description);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    brandHtmlPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: `${brand.name} — Mock Interview Practice`,
        short_name: brand.name,
        description: brand.description,
        theme_color: "#5b8def",
        // Matches styles.css --bg — the app is a single dark theme now, so
        // this is just the base background, not a dark-mode-only fallback.
        background_color: "#0a0b0d",
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
