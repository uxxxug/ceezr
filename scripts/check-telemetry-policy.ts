/**
 * الغرض: بوابة CI تفرض حدودَ القياسِ في البند `F1-08` — وهي حدودٌ قرّرها مالكُ
 *    المنتجِ صراحةً (ADR 0043):
 *    (١) **القياسُ لا يخرج من الجهاز**: لا شبكةَ ولا مَنارةَ ولا قناةَ في طبقةِ
 *        القياس، ولا استيرادَ لحدِّ API منها.
 *    (٢) **القياسُ لا يُخزَّن**: لا تخزينَ محلّيّاً ولا كعكةً ولا مخزنَ تيليجرام —
 *        فالأحداثُ في الذاكرةِ وحدَها وتذهب بإغلاقِ التطبيق.
 *    (٣) **لا حقلَ شخصيّاً في القياس**: أسماءُ الحقولِ الشخصيةِ ممنوعةٌ نصّاً في
 *        طبقةِ القياسِ — قائمةُ المسموحِ تمنعها منطقاً وهذا يمنعها كتابةً.
 *    (٤) **لا مزوّدَ قياسٍ خارجيّاً في المستودعِ كلِّه**: لا `@sentry` ولا
 *        `posthog` ولا سواهما — إدخالُ مزوّدٍ قرارٌ لم يُتَّخذ.
 *    (٥) **معرّفُ الطلبِ يولّده الخادمُ وحدَه**: الرأسُ يُضبَط في موضعٍ واحدٍ في
 *        البوابةِ، ويُقرَأ في موضعٍ واحدٍ في العميل.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: حين يُقرَّر مَصرِفٌ ناقلٌ (إن قُرِّر) فالواجبُ **استثناءُ ملفِّه
 *    وحدَه بنصِّه** لا إلغاءُ القاعدةِ الأولى؛ ومعه ADR جديدٌ لأنّ القرارَ يُنقَض
 *    لا يُوسَّع. وميزانيةُ الأداءِ (`F1-09`) ليست ههنا.
 *
 * لماذا فحصٌ لا اتفاق: سطرٌ واحدٌ `fetch("https://analytics…")` داخلَ طبقةِ القياسِ
 * ينقل بياناتِ المستخدمين إلى طرفٍ ثالثٍ بلا أن يظهر في شاشةٍ ولا في مراجعةٍ
 * عابرةٍ — ويبقى يعمل. والاتفاقُ يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 *
 * والفحصُ يُسقِط البناءَ أيضاً إن **غابت** المواضعُ المفردةُ أو خلت من مضمونِها:
 * حاجزٌ لا يمكن أن يمرَّ فراغاً.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html"]);

/** جذورُ الشيفرةِ الحيّةِ في المستودع. */
const SCAN_ROOTS = ["apps", "packages", "scripts", "tests"] as const;

/** طبقةُ القياسِ: أضيقُ الحدودِ تُطبَّق ههنا. */
const TELEMETRY_DIR = "apps/miniapp/src/telemetry";
/** موضعُ قراءةِ رأسِ معرّفِ الطلبِ في العميل. */
const CLIENT_FILE = "apps/miniapp/src/api/client.ts";
/** موضعُ ضبطِ رأسِ معرّفِ الطلبِ في الخادم — الوحيد. */
const REQUEST_ID_FILE = "apps/gateway/src/observability/request-id.ts";
const SERVER_FILE = "apps/gateway/src/server.ts";
const EVENTS_FILE = `${TELEMETRY_DIR}/events.ts`;
const SINK_FILE = `${TELEMETRY_DIR}/sink.ts`;
const TELEMETRY_FILE = `${TELEMETRY_DIR}/telemetry.ts`;
/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً فيُستثنى. */
const SELF = "scripts/check-telemetry-policy.ts";

const isTest = (file: string): boolean => file.includes(".test.");
/** شيفرةُ إنتاجٍ داخلَ طبقةِ القياس. */
const isTelemetrySource = (file: string): boolean =>
  file.startsWith(TELEMETRY_DIR) && !isTest(file);
const inTelemetry = (file: string): boolean => file.startsWith(TELEMETRY_DIR);

interface Rule {
  readonly pattern: RegExp;
  readonly why: string;
  /** `true` = القاعدةُ تُطبَّق على هذا الملف. */
  readonly applies: (file: string) => boolean;
}

const RULES: readonly Rule[] = [
  {
    pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bnew\s+WebSocket\b|\bEventSource\b/,
    why: "القياسُ لا يخرج من الجهازِ: لا نداءَ شبكةٍ في طبقةِ القياس (قرارُ المالك · ADR 0043)",
    applies: inTelemetry,
  },
  {
    pattern: /from\s+["'][^"']*api\/client(?:\.ts)?["']/,
    why: "طبقةُ القياسِ لا تعرف حدَّ API: الاتجاهُ من الحدِّ إليها لا العكسَ (F1-08)",
    applies: isTelemetrySource,
  },
  {
    pattern:
      /\blocalStorage\b|\bsessionStorage\b|document\s*\.\s*cookie|\bindexedDB\b|SecureStorage|CloudStorage/,
    why: "القياسُ لا يُخزَّن على الجهازِ: الأحداثُ في الذاكرةِ وحدَها (F1-08 · ADR 0043)",
    applies: inTelemetry,
  },
  {
    pattern: /\bsetInterval\s*\(|\bsetTimeout\s*\(|\bqueueMicrotask\s*\(/,
    why: "لا مؤقّتَ في طبقةِ القياس: لا دفعاتَ مؤجّلةً ولا استقصاءَ (ADR 0035 §4 · F1-08)",
    applies: inTelemetry,
  },
  {
    pattern:
      /\btelegram_id\b|\btelegramId\b|\bphone\b|\blatitude\b|\blongitude\b|\blng\b|\bfirstName\b|\blastName\b|\binitData\b|\baccessToken\b|\brefreshToken\b|\bhash\b/,
    why: "لا حقلَ شخصيّاً في القياس: قائمةُ المسموحِ تمنعه منطقاً وهذا يمنعه كتابةً (F1-08 · القسم 12)",
    applies: isTelemetrySource,
  },
  {
    pattern:
      /["'@/](?:@sentry|posthog|mixpanel|amplitude|logrocket|datadog-rum|@datadog\/browser|firebase\/analytics|react-ga|google-analytics)/i,
    why: "لا مزوّدَ قياسٍ خارجيّاً في المستودع: إدخالُه قرارٌ لم يُتَّخذ ويلزمه ADR (F1-08)",
    applies: () => true,
  },
  {
    pattern: /\bgtag\s*\(|\bdataLayer\b|\bwindow\s*\.\s*analytics\b/,
    why: "لا وسمَ قياسٍ خارجيّاً: القياسُ لا يخرج من الجهاز (F1-08)",
    applies: () => true,
  },
  {
    pattern: /["'`]x-request-id["'`]/i,
    why: "معرّفُ الطلبِ يُقرَأ في موضعٍ واحدٍ في العميلِ ويُضبَط في موضعٍ واحدٍ في الخادمِ (ADR 0043)",
    applies: (file) => !isTest(file) && file !== CLIENT_FILE && file !== REQUEST_ID_FILE,
  },
  {
    pattern: /\bcrypto\s*\.\s*randomUUID\b/,
    why: "العميلُ لا يولّد معرّفَ طلبٍ: الخادمُ وحدَه يولّده (قرارُ المالك · ADR 0043)",
    applies: (file) => file.startsWith("apps/miniapp/src") && !isTest(file),
  },
];

/**
 * يُفرِّغ التعليقاتَ قبلَ المطابقة: التعليقاتُ تشرح القاعدةَ فتذكر الأسماءَ
 * الممنوعةَ نصّاً، ولا تُنفِّذ شيئاً. والتفريغُ يُبقي أطوالَ الأسطرِ كما هي كي
 * تبقى أرقامُها صحيحةً في البلاغ.
 */
function blankComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (two === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += "  ";
      index += 2;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly why: string;
}

/** حاجزٌ لا يمرُّ فراغاً: الموضعُ موجودٌ ويحوي فعلاً ما يُنسَب إليه. */
function requirePresence(file: string, needles: readonly string[], item: string): void {
  let source = "";
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`✗ موضعٌ مفقود: ${file} (${item})`);
    process.exit(1);
  }
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length > 0) {
    console.error(`✗ ${file} لا يحوي: ${missing.join(" · ")} (${item})`);
    process.exit(1);
  }
}

function main(): void {
  const violations: Violation[] = [];
  const files = walk(".")
    .map((file) => (file.startsWith("./") ? file.slice(2) : file))
    .filter((file) => SCAN_ROOTS.some((root) => file.startsWith(`${root}/`)))
    .filter((file) => file !== SELF);

  for (const file of files) {
    const lines = blankComments(readFileSync(file, "utf8")).split("\n");
    for (const [index, text] of lines.entries()) {
      for (const rule of RULES) {
        if (!rule.applies(file)) continue;
        if (!rule.pattern.test(text)) continue;
        violations.push({ file, line: index + 1, text: text.trim().slice(0, 160), why: rule.why });
      }
    }
  }

  requirePresence(
    EVENTS_FILE,
    ["sanitizeEvent", "normalizePath", "TelemetryEvent"],
    "F1-08 · تنقيةُ الأحداث",
  );
  requirePresence(SINK_FILE, ["noopSink", "createMemorySink"], "F1-08 · المَصرِف");
  requirePresence(TELEMETRY_FILE, ["createTelemetry", "sanitizeEvent"], "F1-08 · طبقةُ القياس");
  requirePresence(
    REQUEST_ID_FILE,
    ["createRequestIdMiddleware", "REQUEST_ID_HEADER"],
    "F1-08 · معرّفُ الطلبِ في الخادم",
  );
  requirePresence(SERVER_FILE, ["createRequestIdMiddleware"], "F1-08 · وَصْلُ المعرّفِ بالخادم");
  requirePresence(CLIENT_FILE, ["readRequestId", "observe"], "F1-08 · قراءةُ المعرّفِ في العميل");

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لحدودِ القياس (F1-08 · ADR 0043):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ القياسُ لا يخرج من الجهازِ ومعرّفُ الطلبِ من الخادمِ وحدَه (${files.length} ملفاً مفحوصاً · ${RULES.length} قواعد)`,
  );
}

main();
