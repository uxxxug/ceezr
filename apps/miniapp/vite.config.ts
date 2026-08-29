import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { injectCsp } from "./vite/inject-csp.ts";
import { inlineStylesheet } from "./vite/inline-stylesheet.ts";

/**
 * F1-01 — static-asset build for Telegram Mini App (and browser fallback later).
 * Served as immutable assets from CDN; no SSR (ROADMAP §9.2).
 * Single origin only — no third-party executable origins (TG-005 / ADR 0028).
 */
export default defineConfig({
  /**
   * `F1-10`: `injectCsp` **بعدَ** `inlineStylesheet` في هذا المصفوفِ ولا يُقلَب:
   * بصمةُ كتلةِ الأنماطِ تُقرأ من المستندِ بعدَ دمجِها فيه. ولو سبقها لبَصَّم لا
   * شيءَ، ومرَّ البناءُ أخضرَ وظهر التطبيقُ بلا أنماطٍ على الجهازِ (ADR 0045).
   */
  plugins: [react(), inlineStylesheet(), injectCsp()],
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
          /**
           * `F1-09`: حزمةُ `identity` **منفصلةٌ** كما ينصُّ القسم 9.4 — وكانت
           * مُدمَجةً في `shell` منذ `F1-01` بلا سندٍ في الجدول. والجدولُ يجعلهما
           * حزمتَين تُحمَّلان فوراً معاً، فالفصلُ لا يؤخّر شيئاً ويُبقي حدَّ
           * المسؤوليةِ ظاهراً في المُخرَجِ كما هو في الشيفرة.
           *
           * و**حاملُ الجلسةِ ليس منها**: الجدولُ يذكر «الجلسة» في `shell`
           * صريحاً، وحدُّ API يقرأ الرمزَ من ذلك الحاملِ في كلِّ طلبٍ. فلو وضعناه
           * في `identity` لاستوردت `shell` حزمةَ `identity` واستوردت `identity`
           * حزمةَ `shell`، فتقوم دائرةٌ بين الحزمتَين حذّر منها الجامعُ صراحةً.
           * فالتقسيمُ: `identity` = الإقلاعُ والتجديدُ وقراءةُ الدورِ، و`shell` =
           * الحاملُ وتخزينُه الآمنُ (ADR 0044).
           */
          if (
            id.includes("/src/identity/") &&
            !id.includes("/src/identity/session.ts") &&
            !id.includes("/src/identity/session-storage.ts")
          ) {
            return "identity";
          }
          if (
            id.includes("/src/identity/session") ||
            /**
             * `F1-09`: حدُّ HTTP في `shell` صراحةً لا بالإسنادِ التلقائيّ: يستخدمه
             * فحصُ الصحةِ وقراءةُ الدورِ والإقلاعُ معاً، وموضعٌ يختاره الجامعُ وحدَه
             * يتغيرُّ مع أوّلِ مستوردٍ جديدٍ، فتنتقل بايتاتٌ بين الحزمِ بلا قرارٍ.
             */
            id.includes("/src/api/") ||
            id.includes("/src/shell/") ||
            id.includes("/src/routing/") ||
            /** `F1-06`: طبقةُ السمةِ والاتجاهِ من حزمةِ `shell` — «الإطار، السمة» (9.4). */
            id.includes("/src/styles/") ||
            /**
             * `F1-07`: شاشاتُ الحالاتِ وتصنيفُ الفشلِ — «حدودُ الخطأ» من حزمةِ
             * `shell` (9.4). وموضعُها في `shell` لازمٌ لا تنظيميّ: شاشةُ «لا
             * اتصال» يجب أن تكون محمَّلةً سلفاً — حزمةٌ تُجلَب عندَ الفشلِ لا
             * تُجلَب عندَ الفشل.
             */
            id.includes("/src/system/") ||
            /**
             * `F1-08`: طبقةُ القياسِ من حزمةِ `shell` لا حزمةً مستقلّةً: أوّلُ
             * حدثٍ يُسجَّل في **الإقلاعِ نفسِه**، وحزمةٌ تُجلَب لتقيسَ الإقلاعَ
             * تفوتها اللحظةُ التي جاءت لأجلِها. وحجمُها ضئيلٌ: منطقٌ نقيٌّ بلا
             * تبعيّاتٍ ولا شبكةٍ (ADR 0043).
             */
            id.includes("/src/telemetry/") ||
            /**
             * `F1-09`: طبقةُ تيليجرامَ من حزمةِ `shell` **لا حزمةً باسمِها**:
             * `tg` ليست في جدولِ القسم 9.4 إطلاقاً، وكانت حزمةً قائمةً في
             * المُخرَجِ منذ `F1-02` — أي تقسيمٌ بلا إذنٍ من العقدِ، وطلبَ شبكةٍ
             * زائداً في مسارِ أوّلِ رسمٍ. وموضعُها `shell` لأنّ الجدولَ يجعل
             * «السمة» فيه، وطبقةُ المضيفِ هي ما تقوم عليه السمةُ والجلسةُ معاً.
             */
            id.includes("/src/tg/")
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
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
    /**
     * `F1-09`: الميزانيةُ صارت بوّابةً تُسقِط البناءَ في
     * `scripts/check-performance-budget.ts` — وهذا التحذيرُ يبقى إشارةً مبكّرةً
     * للمطوّرِ في طرفيّته، لا حاجزاً. والحاجزُ يقرأ البايتاتَ بعدَ الضغطِ لا قبلَه.
     */
    chunkSizeWarningLimit: 180,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
