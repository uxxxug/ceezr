/**
 * الغرض: يمنع عودةَ العيبِ الذي أحمرَ آلةَ التكامل بلا سببٍ ظاهر — ملفُّ اختبارٍ
 *   يبني حاويةَ التطبيق في `beforeEach` ولا يُغلقها إلّا مرّةً واحدةً في
 *   `afterAll`. كلُّ حاويةٍ تحتجز حوضَ اتّصالاتٍ خاصّاً بها، فيتراكم بعددِ
 *   اختباراتِ الملفّ حتى تردّ القاعدةُ «sorry, too many clients already» فيُخفق
 *   سربٌ من اختباراتٍ سليمةٍ لا علاقةَ لها بالعيب. القاعدةُ المحلّية كانت تحتمل
 *   التراكمَ بسعتها الأوسع، فلم يظهر العيبُ إلّا على الآلةِ البعيدة.
 * الحالة: منفّذ فعلياً — بوّابةُ CI، ومُختبَر في tests/unit/check-test-container-lifecycle.test.ts
 * ينتمي إلى: scripts (أدوات التحقّق)
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml وسكربت `ci` في package.json
 * ملاحظات مستقبلية: إن ظهر نمطُ إنشاءٍ آخرَ للحاوية (مصنعٌ ملتفٌّ مثلاً) يُضاف
 *   اسمُه إلى `CREATION_MARKERS` لا يُوسَّع الفحصُ إلى تحليلٍ رمزيٍّ كامل.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** جذورُ الاختباراتِ التي تُشغَّل على قاعدةٍ حقيقية فتستهلك اتّصالاتٍ فعلية. */
const TEST_ROOTS = ["tests/integration", "tests/e2e"] as const;

/** استدعاءُ بناءِ الحاوية. أيُّ نمطٍ جديدٍ يُضاف هنا صراحةً. */
const CREATION_MARKERS = ["buildContainer("] as const;

/** إغلاقُ الحاوية بأيِّ اسمِ متغيّر. */
const CLOSE_PATTERN = /\b[A-Za-z_$][\w$]*\s*(?:as[^)]*\)?)?\)?\??\.close\(\)/;

export interface LifecycleFinding {
  readonly file: string;
  readonly reason: string;
}

/**
 * يقتطع جسمَ أوّلِ نداءٍ لخُطّافٍ باسمِه، بموازنةِ الأقواسِ المعقوفة.
 * مُصدَّرة لتُختبر وحدها بلا قراءةِ ملفّات.
 */
export function hookBody(source: string, hook: string): string | null {
  const index = source.search(new RegExp(`\\b${hook}\\s*\\(`));
  if (index < 0) return null;
  const open = source.indexOf("{", index);
  if (open < 0) return null;
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, cursor + 1);
    }
  }
  return null;
}

/**
 * يحكم على ملفٍّ واحد: بناءٌ لكلِّ اختبارٍ بلا إغلاقٍ لكلِّ اختبارٍ عيبٌ.
 * مُصدَّرة ليُختبر الحكمُ على نصٍّ مُصطنَعٍ في كلا الاتّجاهين.
 */
export function analyseSource(file: string, source: string): LifecycleFinding | null {
  if (!CREATION_MARKERS.some((marker) => source.includes(marker))) return null;
  const beforeEach = hookBody(source, "beforeEach");
  if (beforeEach === null) return null;
  const buildsPerTest = CREATION_MARKERS.some((marker) => beforeEach.includes(marker));
  if (!buildsPerTest) return null;
  const afterEach = hookBody(source, "afterEach");
  const closesPerTest =
    (afterEach !== null && CLOSE_PATTERN.test(afterEach)) || CLOSE_PATTERN.test(beforeEach);
  if (closesPerTest) return null;
  return {
    file,
    reason:
      "يبني حاويةً في beforeEach ولا يُغلقها لكلِّ اختبار — أحواضُ الاتّصالات تتراكم حتى تُنفَد اتّصالاتُ القاعدة",
  };
}

function collectTestFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".test.ts")) found.push(path);
    }
  };
  try {
    walk(root);
  } catch {
    // جذرٌ غيرُ موجودٍ ليس عيباً في هذه البوّابة.
  }
  return found;
}

export function scanRepository(): readonly LifecycleFinding[] {
  const findings: LifecycleFinding[] = [];
  for (const root of TEST_ROOTS) {
    for (const file of collectTestFiles(root)) {
      const finding = analyseSource(file, readFileSync(file, "utf8"));
      if (finding !== null) findings.push(finding);
    }
  }
  return findings;
}

if (import.meta.main) {
  const findings = scanRepository();
  if (findings.length === 0) {
    console.log("✓ كلُّ ملفِّ اختبارٍ يبني حاويةً لكلِّ اختبارٍ يُغلقها لكلِّ اختبار");
    process.exit(0);
  }
  console.error("✗ حاوياتٌ تُبنى لكلِّ اختبارٍ ولا تُغلق إلّا مرّةً واحدة:");
  for (const finding of findings) console.error(`  - ${finding.file}: ${finding.reason}`);
  process.exit(1);
}
