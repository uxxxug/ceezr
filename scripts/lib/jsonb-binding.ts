/**
 * الغرض: قاعدةُ حاجزٍ واحدةٌ — **لا يُربَطُ مُعامِلٌ بـ`::jsonb` مباشرةً** في أيِّ
 *   قالبِ `sql` في المستودَعِ. البديلُ المشروعُ ثلاثةٌ: `sql.json(x)::jsonb`
 *   (السائقُ يُرمِّزُ مرّةً واحدةً)، أو `to_jsonb(x::نوع)` (القاعدةُ تُرمِّزُ)، أو
 *   `${x}::text::jsonb` (النوعُ مُثبَّتٌ نصّاً فيمرُّ البايتُ كما هو).
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-jsonb-binding.ts و tests/unit/check-jsonb-binding.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يكتبُ `jsonb` من العميلِ — وهم كثيرٌ.
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 * في `$1::jsonb` يستنبِطُ PostgreSQL نوعَ المُعامِلِ من هدفِ التحويلِ، فيصيرُ
 * المُعامِلُ `jsonb`، فيُرمِّزُ سائقُ `postgres.js` القيمةَ JSONاً **ثانيةً**:
 * فالنصُّ `90` يصلُ القاعدةَ `"90"` — `jsonb` من نوعِ `string` — والرقمُ يصيرُ
 * نصّاً بلا خطأٍ ولا سجلٍّ. وهذا العطبُ دُفِعَ ثمنُه في هذا المستودَعِ **أربعَ
 * مرّاتٍ**:
 *   ١) `packages/infrastructure/financial/payment-adapters.ts` — أوّلُ مرّةٍ.
 *   ٢) `packages/infrastructure/broadcast/broadcast-adapters.ts` — مرشِّحاتُ بثٍّ
 *      وصلَت نصّاً فقرأَتها القاعدةُ `null` **فذهبَ البثُّ إلى الجمهورِ كلِّه**.
 *   ٣) `tests/integration/driver-location-freshness.test.ts` — تلويثُ إعدادٍ
 *      مشتركٍ بصمتٍ.
 *   ٤) `tests/integration/ride-share.test.ts` (`F2-09`) — إعادةُ إعدادٍ محذوفٍ
 *      خرقَت `platform_settings_value_type_coherent` **فبقيَت مدينةُ الاختبارِ
 *      ناقصةَ مفتاحٍ فسقطَ خمسةَ عشرَ اختباراً في ملفّاتٍ لا علاقةَ لها بالبندِ**.
 * وكانَ الدرسُ مكتوباً في ثلاثةِ تعليقاتٍ **ولم يكن مُنفَذاً آلةً** — فتعليقٌ
 * يُقرأُ حينَ يُبحَثُ عنه، والحاجزُ يُقرأُ في كلِّ دفعةٍ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يفحصُ SQL الهجراتِ**: `'90'::jsonb` في هجرةٍ حرفٌ ثابتٌ لا مُعامِلٌ،
 *    ولا سائقَ يُرمِّزُه.
 * ــ **لا يمنعُ `::jsonb` نفسَه**: يمنعُ **ربطَ مُعامِلٍ** بهِ بلا واحدٍ من
 *    الأبدالِ الثلاثةِ.
 * ــ **لا يفحصُ ملفَّ سالباتِهِ نفسَه**: موضِعٌ واحدٌ مُعلَنٌ أدناه،
 *    ويحرُسُهُ اختبارٌ يقُولُ **هذا وحدَه**، فاستثناءٌ يتّسِعُ بلا قَودٍ بابٌ.
 * ــ **لا يقرأُ نوعَ القيمةِ**: نصّاً كانت أو رقماً أو كائناً، الحكمُ واحدٌ —
 *    فالعطبُ في مسارِ الترميزِ لا في القيمةِ.
 */

import { toPosixPath } from "./repo-path.ts";

/** جذورُ الشِّفرةِ المفحوصةُ — كلُّ ما يُكتَبُ فيه قالبُ `sql`. */
export const JSONB_SCAN_ROOTS = ["packages", "apps", "tests", "scripts"] as const;

/**
 * `${...}::jsonb` بلا وسيطٍ. والقبضُ على اسمِ المُعامِلِ ليُقرأَ في الرسالةِ:
 * رسالةٌ تقولُ «أيَّ مُعامِلٍ» تُصلَحُ في دقيقةٍ، ورسالةٌ تقولُ «سطرٌ ما» تُهمَلُ.
 */
const BARE_JSONB_BINDING = /\$\{([^{}]*)\}\s*::\s*jsonb/g;

/**
 * الأبدالُ المشروعةُ. `sql.json(` يُرمِّزُ مرّةً واحدةً بيدِ السائقِ، و`::text::`
 * يُثبِّتُ نوعَ المُعامِلِ نصّاً. و`to_jsonb(` لا يظهرُ ههنا إذ لا يُطابِقُ النمطَ
 * أصلاً — القيمةُ تُربَطُ داخلَ الدالّةِ لا قبلَ `::jsonb`.
 */
function isAllowedBinding(expression: string): boolean {
  const trimmed = expression.trim();
  if (trimmed.startsWith("sql.json(")) return true;
  if (trimmed.endsWith("::text")) return true;
  return false;
}

/**
 * ملفُّ السالباتِ المزروعةِ وحدَه: واجبُهُ أن يحملَ النمطَ الممنوعَ نصّاً
 * — ومنهُ **السطرُ الذي أسقطَ CI بالفعلِ** — وإلّا لم يُقَسِ الحاجزُ.
 * والاستثناءُ ههنا — لا في الماسحِ — لأنَّ الدالّةَ مُصَدَّرةٌ ويستدعيها غيرُهُ
 * بمسارٍ من عندِهِ، فاستثناءٌ يعتمدُ على مَن جمعَ المسارَ استثناءٌ هشّ.
 */
export const PLANTED_NEGATIVE_FILES: ReadonlySet<string> = new Set([
  "tests/unit/check-jsonb-binding.test.ts",
]);

export interface JsonbViolation {
  readonly file: string;
  readonly line: number;
  readonly expression: string;
}

/**
 * يقرأُ نصَّ ملفٍّ ويردُّ خرقَه. دالّةٌ خالصةٌ: الاختبارُ يزرعُ نصّاً ولا يحتاجُ
 * قرصاً — وبلا ذلكَ يصيرُ قياسُ الحاجزِ رهنَ ما يصادفُه في المستودَعِ.
 */
export function jsonbViolationsIn(file: string, source: string): readonly JsonbViolation[] {
  if (PLANTED_NEGATIVE_FILES.has(toPosixPath(file))) return [];
  const found: JsonbViolation[] = [];
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    // تعليقٌ يشرحُ العطبَ ليسَ عطباً: التعليقاتُ الثلاثةُ في المستودَعِ تكتبُ
    // النمطَ المعطوبَ **لتحذِّرَ منه**، فلو حُسِبَت خرقاً لَحُذِفَ الدرسُ
    // ليخضرَّ الحاجزُ — وذاكَ محوُ دليلٍ (ح-١).
    const code = line.trimStart();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    for (const match of line.matchAll(BARE_JSONB_BINDING)) {
      const expression = match[1] ?? "";
      if (isAllowedBinding(expression)) continue;
      found.push({ file, line: index + 1, expression: `\${${expression}}::jsonb` });
    }
  }
  return found;
}

/** رسالةُ الخرقِ — تقولُ البديلَ لا العيبَ وحدَه. */
export function describeJsonbViolation(violation: JsonbViolation): string {
  return [
    `${violation.file}:${violation.line}: ${violation.expression}`,
    "      ربطُ مُعامِلٍ بـ`::jsonb` يجعلُ السائقَ يُرمِّزُ القيمةَ ثانيةً فتصلُ القاعدةَ",
    "      `jsonb` من نوعِ `string` بلا خطأٍ ولا سجلٍّ. البديلُ: `sql.json(x)::jsonb`",
    "      أو `to_jsonb(x::نوع)` أو `${x}::text::jsonb`.",
  ].join("\n");
}
