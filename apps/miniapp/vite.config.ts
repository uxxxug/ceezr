import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { assertInitialDictionaries } from "./vite/assert-initial-dictionaries.ts";
import { assertPrebootPlacement } from "./vite/assert-preboot-placement.ts";
import { injectCsp } from "./vite/inject-csp.ts";
import { inlineEntryScript } from "./vite/inline-entry-script.ts";
import { inlineStylesheet } from "./vite/inline-stylesheet.ts";

/**
 * F1-01 — static-asset build for Telegram Mini App (and browser fallback later).
 * Served as immutable assets from CDN; no SSR (ROADMAP §9.2).
 * Single origin only — no third-party executable origins (TG-005 / ADR 0028).
 *
 * D-23 — جامعُ Rolldown عبر `vite@8` و`@vitejs/plugin-react@6`:
 * حلَّ `codeSplitting.groups` محلَّ `manualChunks` القديمِ، وحزمةُ `rolldown-runtime`
 * القسريّةِ (٢٢٠ بايت) تُولِّدُ طلبَ `modulepreload` سابعاً لا يُستطاعُ إزالتُه.
 * الإصلاحُ: إدماجُ حزمةِ المدخلِ في المستندِ (الأصلُ: طلبٌ شبكيٌّ → الآنَ: `<script
 * type="module">` مُدمَجٌ ببصمةٍ في `script-src`)، فيسقطُ طلبٌ ويعودُ العددُ إلى ٦.
 * والدليلُ في `docs/evidence/toolchain/D-23-20260919.md`.
 */
export default defineConfig({
  /**
   * `F1-10`: `injectCsp` **بعدَ** `inlineStylesheet` و`inlineEntryScript` في هذا
   * المصفوفِ ولا يُقلَب: بصمةُ كتلةِ الأنماطِ والسكربتِ المُدمَجَين تُقرَأ من
   * المستندِ بعدَ دمجِهما فيه. ولو سبقهما لبَصَّم لا شيءَ، ومرَّ البناءُ أخضرَ
   * وظهر التطبيقُ بلا أنماطٍ ولا تنفيذٍ على الجهازِ (ADR 0045).
   */
  plugins: [
    react(),
    inlineStylesheet(),
    inlineEntryScript(),
    // `F1-09` · `D-27`: بعدَ إدماجِ المدخلِ — يُسقِطُ البناءَ إن طُوِيَ التقديمُ فيه.
    assertPrebootPlacement(),
    // `F1-09` · `D-29`: يُسقِطُ البناءَ إن عادَ قاموسٌ غيرُ افتراضيٍّ إلى الحِملِ الأوّلِ.
    assertInitialDictionaries(),
    injectCsp(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rolldownOptions: {
      output: {
        /**
         * D-23 / F1-09 — تقسيمُ الكودِ بحسبِ حزمِ القسم 9.4 عبر `codeSplitting.groups`.
         * حلَّ محلَّ `manualChunks` القديمِ في `vite@6` — كان `manualChunks` يُنتِجُ
         * حزمةً واحدةً كبيرةً (٢٧٦ كيلوبايت) في `vite@8` لأنّ `vite@8` لا يرى إدخالَ
         * `manualChunks` في `transformIndexHtml` فيُلحقُ الكلَّ بالمدخلِ.
         */
        codeSplitting: {
          groups: [
            {
              /**
               * `shell` قبلَ `identity` في الترتيبِ: `session.ts` و`session-storage.ts`
               * من `shell` لا من `identity` (ADR 0044). ولو سبقَ `identity` لالتقطَهما
               * ودارت دائرةٌ بين الحزمتَين.
               *
               * `test` دالّةٌ لا مصفوفةٌ: Rolldown في هذه النسخةِ لا يقبلُ مصفوفةً
               * في `test`، فنجمعُ الأنماطَ بدالّةٍ واحدةٍ.
               */
              name: "shell",
              test: (id: string) =>
                /\/src\/identity\/session/.test(id) ||
                /\/src\/api\//.test(id) ||
                /\/src\/shell\//.test(id) ||
                /\/src\/routing\//.test(id) ||
                /\/src\/styles\//.test(id) ||
                /\/src\/system\//.test(id) ||
                /\/src\/telemetry\//.test(id) ||
                /\/src\/tg\//.test(id),
            },
            {
              name: "identity",
              test: /\/src\/identity\//,
            },
            {
              name: "rider-home",
              test: /\/src\/surfaces\/rider\//,
            },
            {
              name: "driver",
              test: /\/src\/surfaces\/driver\//,
            },
            {
              name: "admin",
              test: /\/src\/surfaces\/admin\//,
            },
            {
              name: "vendor-react",
              test: /[\\/]node_modules[\\/]react(?:-dom)?[\\/]/,
            },
          ],
        },
      },
    },
    /**
     * `F1-09`: الميزانيةُ صارت بوّابةً تُسقِط البناءَ في
     * `scripts/check-performance-budget.ts` — وهذا التحذيرُ يبقى إشارةً مبكّرةً
     * للمطوّرِ في طرفيّتهِ، لا حاجزاً. والحاجزُ يقرأ البايتاتَ بعدَ الضغطِ لا قبلَه.
     */
    chunkSizeWarningLimit: 180,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
