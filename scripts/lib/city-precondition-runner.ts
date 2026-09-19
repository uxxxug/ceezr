/**
 * # مُشغِّلُ حاجزِ عقدِ تفعيلِ المدينةِ — نداءٌ واحدٌ لنقطتَي دخولٍ (`OPS-020`)
 *
 * **الغرض:** ألّا يكونَ في المستودعِ منطقُ تقريرٍ مكرَّرٌ كما كانَ فيه منطقُ
 * حكمٍ مكرَّرٌ. فالطبعُ والخروجُ ههنا مرّةً واحدةً، ونقطتا الدخولِ
 * (`check-integration-city-precondition.ts` و`check-test-city-activation.ts`)
 * تُنادِيانِه بلا قاعدةٍ ولا سجلٍّ عندَهما.
 *
 * **الحالة:** `OPS-020` — منفَّذ (`ADR 0148`).
 *
 * **ينتمي إلى:** `scripts/lib` · الحجزُ `OPS-020` في `ROADMAP.md`.
 *
 * **يُستخدم من:** نقطتا الدخولِ أعلاه، وخطوتاهما المسمّاتانِ في `verify`
 * وسلسلةُ `ci`.
 */

import { auditCityPrecondition, type CityPreconditionInput } from "./city-precondition-audit.ts";
import { INTEGRATION_DIR, readRepository } from "./city-precondition-repository.ts";

/** أسماءُ القواعدِ كما تُطبَعُ — كي يُقرأَ الخرقُ بلا فتحِ الشِّفرةِ. */
const RULE_NAMES: Readonly<Record<number, string>> = {
  1: "شرطٌ مسبقٌ مُستعارٌ",
  2: "فعَّلَ ولم يَردَّ",
  3: "نادى المعينَ ولم يَردَّ به",
  4: "عقدُ المعينِ",
  5: "سجلُّ الإعفاءاتِ",
  6: "القروباتُ في نفسِ عبارةِ التفعيلِ",
  7: "سجلُّ إعفاءاتٍ ثانٍ",
};

/**
 * يقرأُ ويَحكُمُ ويطبعُ. يَردُّ رمزَ الخروجِ ولا يُنهي العمليّةَ بنفسِه، كي
 * يُنادِيَه اختبارٌ إن لزمَ.
 */
export function runCityPreconditionGuard(label: string): number {
  let input: CityPreconditionInput;
  try {
    input = readRepository();
  } catch {
    console.error(`✗ لا يُقرأُ المستودَعُ لعقدِ تفعيلِ المدينةِ — وتعذُّرُ القراءةِ لا يُقرأُ نجاحاً.`);
    return 1;
  }

  if (input.integrationFiles.length === 0) {
    console.error(`✗ لا ملفَّ اختبارٍ واحدٌ في ${INTEGRATION_DIR} — حاجزٌ بلا محروسٍ أخضرُ كاذبٌ، فيُخفِقُ.`);
    return 1;
  }

  const violations = auditCityPrecondition(input);

  if (violations.length > 0) {
    console.error(
      `✗ عقدُ تفعيلِ المدينةِ في الاختباراتِ (\`OPS-019\`/\`OPS-020\` · ${label}): ` +
        `${String(violations.length)} خرقاً في ${String(input.activationFiles.length)} ملفّاً\n`,
    );
    for (const v of violations) {
      console.error(`  [القاعدةُ ${String(v.rule)} — ${RULE_NAMES[v.rule] ?? ""}] ${v.path}`);
      console.error(`      ${v.message}\n`);
    }
    return 1;
  }

  console.log(
    `✓ عقدُ تفعيلِ المدينةِ (\`OPS-019\`/\`OPS-020\` · ${label}): ` +
      `${String(input.integrationFiles.length)} ملفَّ تكاملٍ · ` +
      `${String(input.activationFiles.length)} ملفَّ اختبارٍ في نطاقِ التفعيلِ · ` +
      `${String(input.scriptFiles.length)} ملفَّ شِفرةٍ في \`scripts\` — ` +
      `حَكَمٌ واحدٌ وسجلُّ إعفاءاتٍ واحدٌ بـ${String(input.exemptions.length)} مُدخلاً.`,
  );
  return 0;
}
