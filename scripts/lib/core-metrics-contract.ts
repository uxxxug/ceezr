/**
 * الغرض: قواعدُ حاجزِ **المقاييسِ الأساسيّةِ** (`F8-02`) — منطقٌ خالصٌ يحكمُ على
 *   نصوصٍ مُعطاةٍ: هل الفئاتُ التسعُ في نصِّ البندِ منشورةٌ فعلاً؟ وهل الوسومُ
 *   محدودةُ التعدُّدِ؟ وهل المقيسُ يُقاسُ من موضعِ الحقيقةِ لا من نسخةٍ ثانيةٍ؟
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-core-metrics.ts و tests/unit/check-core-metrics.test.ts
 * يُتوقع أن يستخدمه لاحقاً: `F8-07` عندَ ربطِ اللوحاتِ والتنبيهاتِ بهذه العائلاتِ.
 * الحاكم: docs/adr/0131-a-published-metric-is-a-contract-not-a-comment.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 *
 * بندُ `F8-02` يُعَدُّ منجَزاً بجملةٍ واحدةٍ: «المقاييسُ منشورةٌ». وثلاثةُ أعطابٍ
 * تُبقيه أخضرَ وهوَ كاذبٌ:
 *
 *   ١. **فئةٌ تُذكَرُ في الوثيقةِ ولا تُنشَرُ في الشِفرةِ** — «ذاكرةٌ» و«اتصالاتٌ»
 *      كانتا مكتوبتَينِ في نصِّ البندِ ولا مقياسَ لهما في المستودَعِ كلِّه.
 *   ٢. **وسمٌ يحملُ معرِّفاً** — سلسلةٌ لكلِّ طلبٍ تُسقِطُ المُجمِّعَ، فتصيرُ
 *      المراقبةُ هيَ العطبَ؛ ويُكتشَفُ ذلكَ في الإنتاجِ لا في المراجعةِ.
 *   ٣. **نسبةٌ محسوبةٌ تُنشَرُ مقياساً** — «معدَّلُ قبولِ العروضِ» رقماً ثالثاً
 *      يخالفُ بسطَه ومقامَه عندَ إعادةِ التشغيلِ، فيُقرأُ رقمانِ متناقضانِ.
 *
 * وكلُّ قاعدةٍ ههنا لها **سالبٌ مبذورٌ** في `tests/unit/check-core-metrics.test.ts`
 * (`ح-٧`): حاجزٌ لم يُرَ ساقطاً لم يُقَسْ.
 *
 * ## وما لا تفعلُه هذه القواعدُ عن قصدٍ — (`ح-٥`)
 *
 *   ــ **لا تُثبِتُ أنَّ أحداً يقرأُ المقاييسَ**: لا جامعَ ولا لوحةَ ولا تنبيهَ في
 *      المستودَعِ (`F8-07` · `OPS-003`). المُثبَتُ **النشرُ** لا الاستهلاكُ.
 *   ــ **لا تقيسُ صوابَ الرقمِ**: أنَّ `waslah_process_resident_memory_bytes`
 *      يساوي ما يراهُ النظامُ شأنُ اختبارِ تكاملٍ لا شأنُ ماسحِ نصوصٍ.
 *   ــ **لا تمنعُ إضافةَ عائلةٍ**: تمنعُ **حذفَ فئةٍ** وتمنعُ وسماً منفجرَ التعدُّدِ.
 *   ــ **لا تُصلِحُ آلياً**: اسمُ العائلةِ وحدودُ وسومِها قرارُ مؤلِّفٍ، وحقنُه
 *      تخميناً يُنتِجُ مقياساً يمرُّ بلا أن يُقاسَ.
 */

import { routeLabel } from "../../packages/infrastructure/observability/http-metrics.ts";

/** الملفّاتُ المحروسةُ — غيابُ أيٍّ منها **مخالفةٌ** لا تخطٍّ صامتٌ. */
export const GUARDED_FILES = {
  definitions: "packages/infrastructure/observability/metrics.ts",
  labels: "packages/infrastructure/observability/http-metrics.ts",
  process: "packages/infrastructure/observability/process-metrics.ts",
  collector: "packages/infrastructure/observability/database-gauges.ts",
  middleware: "apps/gateway/src/observability/http-metrics.ts",
  route: "apps/gateway/src/routes/metrics.ts",
} as const;

export type GuardedFileKey = keyof typeof GUARDED_FILES;

/**
 * الفئاتُ التسعُ من نصِّ البندِ `F8-02` حرفاً، وإلى جانبِ كلِّ واحدةٍ **العائلةُ
 * التي تُجيبُ عنها**. وهذا الجدولُ هوَ الجسرُ بينَ الوثيقةِ والشِفرةِ: فئةٌ بلا
 * عائلةٍ مُعرَّفةٍ = بندٌ يدّعي ما لا يملكُ.
 */
export const REQUIRED_CATEGORIES: readonly {
  readonly category: string;
  readonly families: readonly string[];
}[] = [
  { category: "معدل", families: ["waslah_http_requests_total"] },
  { category: "تأخّر", families: ["waslah_http_request_duration_seconds"] },
  { category: "طوابير", families: ["waslah_queue_depth", "waslah_queue_claimed"] },
  { category: "أعمار", families: ["waslah_queue_oldest_due_age_seconds"] },
  { category: "أخطاء", families: ["waslah_http_errors_total"] },
  {
    category: "اتصالات",
    families: ["waslah_database_connections", "waslah_database_connections_limit"],
  },
  {
    category: "ذاكرة",
    families: ["waslah_process_resident_memory_bytes", "waslah_process_heap_used_bytes"],
  },
  {
    // معدَّلُ القبولِ **بسطٌ ومقامٌ منشورانِ**، لا نسبةٌ محسوبةٌ مُسبَقاً.
    category: "معدل قبول العروض",
    families: ["waslah_dispatch_offers_sent_total", "waslah_dispatch_offers_accepted_total"],
  },
  {
    category: "زمن الإسناد",
    families: [
      "waslah_order_assignment_seconds",
      "waslah_orders_matched_in_window",
      "waslah_order_assignment_window_seconds",
    ],
  },
];

/**
 * وسومٌ ممنوعةٌ: كلُّ ما ينمو عددُ قيمِه بنموِّ البياناتِ أو يتحكَّمُ فيه مُرسِلُ
 * الطلبِ. و«`path`» و«`url`» ممنوعانِ خاصّةً: هما الطريقُ الأقصرُ إلى سلسلةٍ
 * لكلِّ معرِّفِ رحلةٍ.
 */
export const FORBIDDEN_LABEL_NAMES: readonly string[] = [
  "order_id",
  "ride_id",
  "user_id",
  "driver_id",
  "rider_id",
  "city_id",
  "request_id",
  "trace_id",
  "session_id",
  "path",
  "url",
  "ip",
  "email",
  "phone",
  "token",
];

/** أشكالُ أسماءٍ تعني **نسبةً محسوبةً** — تُقرأُ من البسطِ والمقامِ لا تُنشَرُ رقماً. */
const PRECOMPUTED_RATIO_NAME = /^waslah_[a-z0-9_]*(_rate|_ratio|_percent|_percentage)$/;

const DEFINITION_CALL = /define(?:Counter|Gauge|Histogram)\(\{([\s\S]*?)\}\);/g;
const NAME_FIELD = /name:\s*"([^"]+)"/;
const LABEL_NAMES_FIELD = /labelNames:\s*\[([^\]]*)\]/;

/**
 * يُسقِطُ التعليقاتِ قبلَ الحكمِ على **شِفرةٍ تعملُ**. ولمَ؟ لأنَّ الشرحَ
 * الصادقَ يذكرُ الممنوعَ ليُبيّنَ لمَ هوَ ممنوعٌ — وحاجزٌ يعاقِبُ على **ذِكرِ**
 * العطبِ يُعلِّمُ المؤلِّفينَ أن يكتموا السببَ لا أن يتركوا العطبَ. والمحكومُ
 * عليه ما يُنَفَّذُ.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, " "))
    .join("\n");
}

export interface CoreMetricsViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface MetricDefinitionSite {
  readonly name: string;
  readonly labelNames: readonly string[];
}

/** يقرأُ العائلاتَ المُعرَّفةَ من نصِّ `metrics.ts` — نصّاً لا تشغيلاً. */
export function parseMetricDefinitions(source: string): readonly MetricDefinitionSite[] {
  const found: MetricDefinitionSite[] = [];
  for (const match of source.matchAll(DEFINITION_CALL)) {
    const body = match[1] ?? "";
    const name = NAME_FIELD.exec(body)?.[1];
    if (name === undefined) continue;
    const labelsRaw = LABEL_NAMES_FIELD.exec(body)?.[1] ?? "";
    const labelNames = labelsRaw
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter((entry) => entry !== "");
    found.push({ name, labelNames });
  }
  return found;
}

/**
 * الحكمُ كلُّه على **نصوصٍ مُعطاةٍ** لا على القرصِ، فيُقاسُ بسالباتٍ مبذورةٍ في
 * الذاكرةِ. وملفٌّ محروسٌ **مفقودٌ** يُنتِجُ مخالفةً باسمِه: حاجزٌ يصمتُ عندَ
 * غيابِ ما يحرسُه ليسَ حاجزاً.
 */
export function coreMetricsViolations(
  sources: Readonly<Partial<Record<GuardedFileKey, string>>>,
): readonly CoreMetricsViolation[] {
  const violations: CoreMetricsViolation[] = [];

  for (const [key, path] of Object.entries(GUARDED_FILES) as [GuardedFileKey, string][]) {
    if (sources[key] === undefined || sources[key] === "") {
      violations.push({
        rule: "file.present",
        detail: `الملفُّ المحروسُ غائبٌ أو فارغٌ: ${path} (المفتاحُ ${key}).`,
      });
    }
  }
  if (violations.length > 0) return violations;

  const definitions = parseMetricDefinitions(sources.definitions ?? "");
  const definedNames = new Set(definitions.map((definition) => definition.name));

  // (١) كلُّ فئةٍ في نصِّ البندِ لها عائلةٌ مُعرَّفةٌ فعلاً.
  for (const requirement of REQUIRED_CATEGORIES) {
    for (const family of requirement.families) {
      if (!definedNames.has(family)) {
        violations.push({
          rule: "catalogue.category-published",
          detail:
            `الفئةُ «${requirement.category}» تحتاجُ العائلةَ \`${family}\` ولا تعريفَ لها في ` +
            `${GUARDED_FILES.definitions} — فئةٌ في الوثيقةِ بلا مقياسٍ في الشِفرةِ.`,
        });
      }
    }
  }

  // (٢) لا وسمَ ينفجرُ تعدُّدُه ولا وسمَ يتحكَّمُ فيه مُرسِلُ الطلبِ.
  for (const definition of definitions) {
    for (const label of definition.labelNames) {
      if (FORBIDDEN_LABEL_NAMES.includes(label)) {
        violations.push({
          rule: "label.bounded-cardinality",
          detail:
            `العائلةُ \`${definition.name}\` تحملُ الوسمَ الممنوعَ \`${label}\` — سلسلةٌ لكلِّ ` +
            `صفٍّ أو لكلِّ طلبٍ تُسقِطُ المُجمِّعَ قبلَ أن يُسقِطَ النظامَ عطبٌ حقيقيٌّ.`,
        });
      }
    }
  }

  // (٣) لا نسبةَ محسوبةً تُنشَرُ مقياساً: تُقرأُ من بسطِها ومقامِها.
  for (const definition of definitions) {
    if (PRECOMPUTED_RATIO_NAME.test(definition.name)) {
      violations.push({
        rule: "derived.no-precomputed-ratio",
        detail:
          `العائلةُ \`${definition.name}\` نسبةٌ محسوبةٌ مُسبَقاً — مصدرُ حقيقةٍ ثالثٌ يخالفُ ` +
          `بسطَه ومقامَه عندَ إعادةِ التشغيلِ. يُنشَرُ العدَّادانِ وتُحسَبُ النسبةُ في الاستعلامِ.`,
      });
    }
  }

  // (٤) وسمُ الحافةِ **قالبُ** المسارِ: المسارُ الخامُّ يحملُ معرِّفاً.
  const middleware = stripComments(sources.middleware ?? "");
  if (!middleware.includes("c.req.routePath")) {
    violations.push({
      rule: "http.route-template-label",
      detail:
        `${GUARDED_FILES.middleware} لا يقرأُ \`c.req.routePath\` — وسمُ الحافةِ يجبُ أن يكونَ ` +
        `قالبَ المسارِ المُعرَّفَ لا المسارَ المطلوبَ.`,
    });
  }
  if (/c\.req\.(path|url)\b/.test(middleware)) {
    violations.push({
      rule: "http.route-template-label",
      detail:
        `${GUARDED_FILES.middleware} يقرأُ \`c.req.path\` أو \`c.req.url\` — كلُّ معرِّفٍ في ` +
        `المسارِ يصيرُ سلسلةً مستقلّةً، وذاكَ انفجارُ التعدُّدِ بعينِه.`,
    });
  }

  // (٥) الاستثناءُ يُعَدُّ ويُعادُ رفعُه: لا يُبتلَعُ ولا يمرُّ بلا عدٍّ.
  if (!middleware.includes("recordHttpUnhandledError") || !/throw\s+cause/.test(middleware)) {
    violations.push({
      rule: "http.error-counted-and-rethrown",
      detail:
        `${GUARDED_FILES.middleware} يجبُ أن يعُدَّ الاستثناءَ بـ\`recordHttpUnhandledError\` ` +
        `ثمَّ يُعيدَ رفعَه (\`throw cause\`): طلبٌ ماتَ بلا عدٍّ ينقصُ من المقامِ فيُقرأُ ` +
        `الانفجارُ هدوءاً، ووسيطٌ يبتلعُ السببَ يُخفي العطبَ الذي يراقبُه.`,
    });
  }

  // (٦) الذاكرةُ تُقرأُ عندَ المسحِ لا بمؤقِّتٍ دائرٍ في العمليّةِ.
  const process_ = stripComments(sources.process ?? "");
  if (/\bset(Interval|Timeout)\s*\(/.test(process_)) {
    violations.push({
      rule: "process.read-at-scrape",
      detail:
        `${GUARDED_FILES.process} يستعملُ مؤقِّتاً — قيمةُ الذاكرةِ لحظيّةٌ تُقرأُ عندَ المسحِ، ` +
        `ومؤقِّتٌ يُنفِقُ عملاً لا يقرأُه أحدٌ ويُدخِلُ خيطاً دائماً في خدمةِ الطلباتِ.`,
    });
  }
  if (!stripComments(sources.route ?? "").includes("setProcessGauges")) {
    violations.push({
      rule: "process.read-at-scrape",
      detail:
        `${GUARDED_FILES.route} لا ينادي \`setProcessGauges\` — عائلةٌ مُعرَّفةٌ لا تُضبَطُ ` +
        `عندَ المسحِ تُنشَرُ صفراً أبداً، وصفرٌ ثابتٌ أسوأُ من غيابٍ لأنَّه يُقرأُ رقماً.`,
    });
  }

  // (٧) نافذةُ زمنِ الإسنادِ **تُنشَرُ** ولا تُترَكُ افتراضاً عندَ القارئِ.
  const collector = stripComments(sources.collector ?? "");
  if (!collector.includes("windowSeconds")) {
    violations.push({
      rule: "assignment.window-published",
      detail:
        `${GUARDED_FILES.collector} لا يُمرِّرُ \`windowSeconds\` — ورقمانِ باسمٍ واحدٍ ` +
        `ونافذتانِ مسكوتٌ عنهما (وههنا لوحةُ \`F7-08\` تقرأُ العمودَينِ نفسَهما بنافذةٍ أخرى) ` +
        `هوَ عينُ الكذبِ.`,
    });
  }
  if (!/matched_at\s*is not null/.test(collector) || !collector.includes("percentile_cont")) {
    violations.push({
      rule: "assignment.measured-from-stamps",
      detail:
        `${GUARDED_FILES.collector} يجبُ أن يقيسَ زمنَ الإسنادِ من \`matched_at\` المكتوبِ ` +
        `بـ\`percentile_cont\` — مؤقِّتٌ في الذاكرةِ يُفقَدُ بإعادةِ التشغيلِ ويكذبُ عندَ ` +
        `تعدُّدِ النسخِ لأنَّ الطلبَ يُنشَأُ في عمليّةٍ ويُسنَدُ في أخرى.`,
    });
  }

  // (٨) عدُّ الاتصالاتِ من رؤيةِ المحرِّكِ لا من مجمعِ العمليّةِ وحدَه، ومعَه السقفُ.
  if (!collector.includes("pg_stat_activity") || !collector.includes("max_connections")) {
    violations.push({
      rule: "connections.engine-view-with-limit",
      detail:
        `${GUARDED_FILES.collector} يجبُ أن يعُدَّ الاتصالاتِ من \`pg_stat_activity\` وأن يقرأَ ` +
        `\`max_connections\` معَها — عدٌّ في العمليّةِ يرى مجمعَ نفسِها وحدَه، وعدٌّ بلا سقفٍ ` +
        `لا يُجيبُ عن السؤالِ: أقاربٌ نحنُ من الحدِّ؟`,
    });
  }

  // (٩) المسارُ يبقى محروساً بسرٍّ ويفشلُ مغلقاً: التوسيعُ لا يفتحُ الكشفَ.
  const route = stripComments(sources.route ?? "");
  if (!route.includes("metricsSecretsMatch") || !route.includes("UNAUTHORIZED")) {
    violations.push({
      rule: "route.stays-protected",
      detail:
        `${GUARDED_FILES.route} يجبُ أن يبقى محروساً بمقارنةِ سرٍّ زمنِها ثابتٌ وأن يفشلَ ` +
        `مغلقاً (\`UNAUTHORIZED\`) — مقاييسُ منصّةٍ مفتوحةٌ تكشفُ أحجامَ الأعمالِ وأوقاتَ الذروةِ.`,
    });
  }

  return violations;
}

/** نداءُ مسارٍ في Hono بقالبٍ حرفيٍّ — يُقرأُ نصّاً لا تشغيلاً. */
const ROUTE_DECLARATION = /\.(?:get|post|put|patch|delete|all)\(\s*"(\/[^"]*)"/g;

/**
 * **كلُّ قالبٍ مُعلَنٍ في البوّابةِ يجبُ أن يبقى وسمَ نفسِه.** وهذهِ القاعدةُ هيَ
 * الحدُّ الآخرُ لقاعدةِ التعدُّدِ: تلكَ تمنعُ وسماً ينفجرُ، وهذهِ تمنعُ حدّاً
 * ضيّقاً **يطمرُ المساراتَ كلَّها في `other`** — ومقياسٌ كلُّ مساراتِه `other`
 * أخرسُ وهوَ أخضرُ. فمَن أضافَ قالباً لا يقبلُه التطبيعُ اختارَ صراحةً: يُوسِّعُ
 * التطبيعَ أو يُسمّي المسارَ اسماً يقبلُه — ولا يمرُّ صامتاً.
 */
export function unlabelledRouteTemplates(
  routeSources: Readonly<Record<string, string>>,
): readonly CoreMetricsViolation[] {
  const violations: CoreMetricsViolation[] = [];
  for (const [path, content] of Object.entries(routeSources)) {
    const seen = new Set<string>();
    for (const match of stripComments(content).matchAll(ROUTE_DECLARATION)) {
      const template = match[1] ?? "";
      if (template === "" || seen.has(template)) continue;
      seen.add(template);
      if (routeLabel(template) === template) continue;
      violations.push({
        rule: "http.every-route-labelled",
        detail:
          `القالبُ \`${template}\` في ${path} يسقُطُ إلى \`other\` عندَ التطبيعِ — ` +
          `مقياسٌ تُطمَرُ فيه المساراتُ كلُّها في وسمٍ واحدٍ أخرسُ وهوَ أخضرُ. ` +
          `وسِّعْ \`routeLabel\` عمداً أو سمِّ المسارَ اسماً يقبلُه.`,
      });
    }
  }
  return violations;
}

export function describeCoreMetricsViolation(violation: CoreMetricsViolation): string {
  return `  • [${violation.rule}] ${violation.detail}`;
}
