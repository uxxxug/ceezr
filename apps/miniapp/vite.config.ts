import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * F1-01 — static-asset build for Telegram Mini App (and browser fallback later).
 * Served as immutable assets from CDN; no SSR (ROADMAP §9.2).
 * Single origin only — no third-party executable origins (TG-005 / ADR 0028).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        /** Code-split by product packages (ROADMAP §9.4). */
        manualChunks(id) {
          if (
            id.includes("/src/shell/") ||
            id.includes("/src/identity/") ||
            id.includes("/src/routing/")
          ) {
            return "shell";
          }
          /**
           * `F1-05` — أسطحُ الأدوارِ حزمٌ منفصلةٌ بأسماءِ القسم 9.4: حزمةُ السائقِ
           * لا تُنزَّل لغيرِ السائقِ، وذاك نصُّ العقدِ لا تحسينٌ اختياري.
           */
          if (id.includes("/src/surfaces/rider/")) {
            return "rider-home";
          }
          if (id.includes("/src/surfaces/driver/")) {
            return "driver";
          }
          if (id.includes("/src/surfaces/admin/")) {
            return "admin";
          }
          if (id.includes("/src/tg/")) {
            return "tg";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
    /** Budget gate (ROADMAP §9.9) enforced later in F1-09; keep baseline tight. */
    chunkSizeWarningLimit: 180,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
