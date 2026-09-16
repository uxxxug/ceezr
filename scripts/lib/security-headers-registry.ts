/**
 * الغرض: سِجلٌّ **مغلقٌ** لأسطحِ الصفحاتِ المُصيَّرةِ في الخادمِ، وللترويساتِ
 *   الواجبةِ على كلٍّ منها — وقواعدُ محضةٌ تكشفُ سطحَ صفحةٍ جديداً لم يُركَّب عليهِ
 *   وسيطُ الترويساتِ، أو رُكِّبَ عليهِ **بشرطٍ** فصارَ وعداً لا ضماناً.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-06` · الرِجلُ الرابعةُ من `F8-08`).
 * ينتمي إلى: scripts/lib
 * يُتوقَّعُ أن يستخدمَهُ: scripts/check-security-headers.ts و
 *   tests/unit/check-security-headers.test.ts.
 * الحاكم: ADR 0135 · `ح-7`
 *
 * ## لِمَ سِجلٌّ مغلقٌ لا بحثٌ عن الوسيطِ حيثُ وُجِدَ
 *
 * الفجوةُ التي سجَّلَها `ADR 0133` في `SEC-06` نصُّها: «لا حاجزَ آليَّ يمنعُ صفحةً
 * عامّةً جديدةً من أن تُركَّبَ بلا الوسيطِ». وحاجزٌ يفحصُ **الموجودَ** لا يكشفُ
 * **الناقصَ**: مَن يُضيفُ ملفَّ صفحةٍ جديداً بلا وسيطٍ يمرُّ سليماً، لأنَّ الحاجزَ
 * لا يعرفُ أنَّ الملفَّ صفحةٌ. فالقياسُ معكوسٌ: **تُكتشَفُ الصفحاتُ من القرصِ**
 * (كلُّ وحدةِ توجيهٍ تُصيِّرُ `HTML`) **ثمَّ تُطابَقُ بالسِجلِّ** — فسطحٌ جديدٌ غيرُ
 * مُسجَّلٍ يُسقِطُ البناءَ، ولا يُسكَتُ إلّا بتسجيلٍ يُوجِبُ عليهِ الوسيطَ.
 *
 * ## ولِمَ يُشتَرَطُ تركيبٌ **بلا شرطٍ**
 *
 * كانَ `public-tracking.ts` يقولُ `if (deps.securityHeaders !== undefined)`. فنسيانُ
 * الوسيطِ في مُنشِئٍ واحدٍ يُخرِجُ صفحةً عامّةً **عاريةً** بلا خطأٍ ولا تحذيرٍ ولا
 * سطرِ سجلٍّ. **وهذا أخطرُ من غيابِ الوسيطِ أصلاً**، لأنَّ الوسيطَ مكتوبٌ فيُقرَأُ
 * تغطيةً. فالقاعدةُ تمنعُ الشرطَ نفسَه — لا تكتفي بوجودِ الاسمِ.
 */

/** أسماءُ الترويساتِ الواجبةِ على كلِّ سطحِ صفحةٍ بلا استثناءٍ. */
export const REQUIRED_PAGE_HEADERS = [
  "Content-Security-Policy",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Cross-Origin-Opener-Policy",
  "Permissions-Policy",
] as const;

export type RequiredPageHeader = (typeof REQUIRED_PAGE_HEADERS)[number];

export interface PageSurface {
  /** معرِّفٌ ثابتٌ يُذكَرُ في الدليلِ والقرارِ. */
  readonly id: string;
  /** وحدةُ التوجيهِ التي تُصيِّرُ `HTML` — مسارٌ نسبيٌّ من جِذرِ المستودَعِ. */
  readonly module: string;
  /** اسمُ الوسيطِ أو الحقلِ الذي يُركَّبُ على `app.use("*", …)` في تلكَ الوحدةِ. */
  readonly middleware: string;
  /** مَن يفتحُ هذا السطحَ: يُغيِّرُ ما يُحتَملُ من تنازلٍ في السياسةِ. */
  readonly audience: "عامٌّ بلا حسابٍ" | "مسؤولٌ بجلسةٍ";
  /** ترويساتٌ زائدةٌ على الواجبِ يفرضُها هذا السطحُ بعينِه. */
  readonly extraHeaders: readonly string[];
}

/**
 * السِجلُّ المغلقُ. **كلُّ سطحٍ جديدٍ يُصيِّرُ `HTML` يجبُ أن يُضافَ ههنا**، وحينَ
 * يُضافُ يَلزَمُه الوسيطُ بلا شرطٍ — فالتسجيلُ ليسَ إعفاءً بل التزامٌ.
 */
export const PAGE_SURFACES: readonly PageSurface[] = [
  {
    id: "PAGE-PUBLIC-TRACK",
    module: "apps/gateway/src/routes/public-tracking.ts",
    middleware: "deps.securityHeaders",
    audience: "عامٌّ بلا حسابٍ",
    // الرمزُ في المسارِ نفسِه، فنسخةٌ في وسيطٍ أو في فهرسِ محرِّكٍ نسخةٌ من موقعِ
    // إنسانٍ تبقى بعدَ انقضاءِ الرمزِ. ولذا يُوجِبُ هذا السطحُ زيادتَينِ.
    extraHeaders: ["Cache-Control", "X-Robots-Tag"],
  },
  {
    id: "PAGE-ADMIN-UI",
    module: "apps/gateway/src/routes/admin-ui.ts",
    middleware: "createAdminSecurityHeaders",
    audience: "مسؤولٌ بجلسةٍ",
    extraHeaders: [],
  },
];

/** ما يُقرأُ من القرصِ لكلِّ وحدةِ توجيهٍ. */
export interface RouteModuleFacts {
  /** مسارٌ نسبيٌّ من جِذرِ المستودَعِ. */
  readonly path: string;
  /** نصُّ الملفِّ كما هوَ. */
  readonly source: string;
}

export interface HeadersViolation {
  readonly rule:
    | "surface.discovered-but-unregistered"
    | "surface.registered-but-missing"
    | "middleware.not-mounted"
    | "middleware.mounted-conditionally"
    | "headers.required-set-written"
    | "headers.extra-written";
  readonly detail: string;
}

/** وسمُ تصييرِ `HTML` في Hono. وحدةٌ فيها هذا الوسمُ سطحُ صفحةٍ. */
const HTML_RENDER_MARKER = /\bc\.html\(/;

/** تركيبُ وسيطٍ على كلِّ المساراتِ. */
function mountsOnAllPaths(source: string, middleware: string): boolean {
  const escaped = middleware.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`app\\.use\\(\\s*"\\*"\\s*,\\s*${escaped}`).test(source);
}

/**
 * تركيبٌ **مشروطٌ**: `if (…) app.use("*", …)` أو `… ? app.use(…) : …`. وهذا هوَ
 * العطبُ بعينِه الذي أُصلِحَ في `public-tracking.ts` — يُمنَعُ عودتُه صامتاً.
 */
function mountsConditionally(source: string, middleware: string): boolean {
  const escaped = middleware.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bif\\s*\\([^\\n]*\\)\\s*app\\.use\\(\\s*"\\*"\\s*,\\s*${escaped}`).test(
    source,
  );
}

export interface HeadersAuditInput {
  /** كلُّ وحداتِ التوجيهِ المقروءةِ من القرصِ. */
  readonly routeModules: readonly RouteModuleFacts[];
  /** نصُّ كلِّ وسيطِ ترويساتٍ، مُفتَرَشاً لقراءةِ مجموعةِ الترويساتِ الفعليّةِ. */
  readonly middlewareSources: readonly string[];
}

/**
 * القواعدُ. لا تلمسُ قرصاً ولا شبكةً — تُغذّى بحقائقَ فتُعيدُ خرقاً، فتُزرَعُ لها
 * السالباتُ في اختبارِ الوحدةِ (`ح-7`).
 */
export function securityHeaderViolations(input: HeadersAuditInput): readonly HeadersViolation[] {
  const violations: HeadersViolation[] = [];
  const registered = new Map(PAGE_SURFACES.map((surface) => [surface.module, surface]));

  // ١. الاكتشافُ أوّلاً: صفحةٌ على القرصِ ليسَت في السِجلِّ تُسقِطُ البناءَ. وبلا
  //    هذهِ القاعدةِ يبقى الحاجزُ فاحصاً للمعروفِ عاجزاً عن كشفِ الجديدِ.
  for (const module of input.routeModules) {
    if (!HTML_RENDER_MARKER.test(module.source)) continue;
    if (!registered.has(module.path)) {
      violations.push({
        rule: "surface.discovered-but-unregistered",
        detail:
          `${module.path}: وحدةُ توجيهٍ تُصيِّرُ HTML وليسَت في سِجلِّ الأسطحِ — ` +
          "فلا شيءَ يُوجِبُ عليها وسيطَ الترويساتِ. تُسجَّلُ في PAGE_SURFACES.",
      });
    }
  }

  const onDisk = new Map(input.routeModules.map((module) => [module.path, module]));

  for (const surface of PAGE_SURFACES) {
    const module = onDisk.get(surface.module);
    // ٢. سطحٌ مُسجَّلٌ لا وجودَ لهُ: السِجلُّ يصيرُ حرفاً ميّتاً يُقرأُ تغطيةً.
    if (module === undefined) {
      violations.push({
        rule: "surface.registered-but-missing",
        detail: `${surface.id}: المسارُ المُسجَّلُ لا وجودَ لهُ على القرصِ — ${surface.module}`,
      });
      continue;
    }
    // ٣. الوسيطُ غيرُ مُركَّبٍ على كلِّ المساراتِ.
    if (!mountsOnAllPaths(module.source, surface.middleware)) {
      violations.push({
        rule: "middleware.not-mounted",
        detail:
          `${surface.id}: لا تركيبَ لـ${surface.middleware} على "*" في ${surface.module} — ` +
          "فصفحةٌ تُصيَّرُ بلا سياسةِ محتوىً.",
      });
    }
    // ٤. مُركَّبٌ **بشرطٍ**: وعدٌ لا ضمانٌ.
    if (mountsConditionally(module.source, surface.middleware)) {
      violations.push({
        rule: "middleware.mounted-conditionally",
        detail:
          `${surface.id}: ${surface.middleware} مُركَّبٌ بشرطٍ في ${surface.module} — ` +
          "ونسيانُهُ في مُنشِئٍ واحدٍ يُخرِجُ صفحةً عاريةً بلا خطأٍ ولا تحذيرٍ. " +
          "يُجعَلُ الحقلُ مطلوباً ويُركَّبُ بلا شرطٍ.",
      });
    }
  }

  // ٥. مجموعةُ الترويساتِ الواجبةِ مصدرُها واحدٌ: كلُّ وسيطٍ يكتبُها كلَّها فعلاً.
  //    وبلا هذهِ القاعدةِ يبقى السِجلُّ يعدُّ الوسائطَ ولا يعرفُ ما تكتبُ.
  for (const source of input.middlewareSources) {
    for (const header of REQUIRED_PAGE_HEADERS) {
      if (!source.includes(`"${header}"`)) {
        violations.push({
          rule: "headers.required-set-written",
          detail: `وسيطُ ترويساتٍ لا يكتبُ الترويسةَ الواجبةَ ${header}.`,
        });
      }
    }
  }

  // ٦. الزياداتُ الخاصّةُ بسطحٍ مكتوبةٌ فعلاً في وسيطِه.
  for (const surface of PAGE_SURFACES) {
    if (surface.extraHeaders.length === 0) continue;
    const written = input.middlewareSources.some((source) =>
      surface.extraHeaders.every((header) => source.includes(`"${header}"`)),
    );
    if (!written) {
      violations.push({
        rule: "headers.extra-written",
        detail:
          `${surface.id}: زياداتُهُ (${surface.extraHeaders.join(" · ")}) ليسَت مكتوبةً في ` +
          "أيِّ وسيطِ ترويساتٍ — والزيادةُ المذكورةُ غيرُ المكتوبةِ دعوى.",
      });
    }
  }

  return violations;
}

export function describeHeadersViolation(violation: HeadersViolation): string {
  return `  · [${violation.rule}] ${violation.detail}`;
}
