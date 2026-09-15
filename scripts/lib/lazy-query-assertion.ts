/**
 * الغرض: قاعدةُ حاجزٍ واحدةٌ — **لا وسمَ استعلامٍ مُرجَأً داخلَ `expect(…)`**.
 *   استعلامُ `postgres.js` مُرجئٌ لا وعدٌ منطلقٌ، فتمريرُه إلى `expect(…)`
 *   يُنتِجُ وعداً لا يُحسَمُ أبداً — أي **تعليقاً صامتاً** لا فشلاً.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-lazy-query-assertion.ts و
 *   tests/unit/check-lazy-query-assertion.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ تكاملٍ يقيسُ **رفضَ** دالّةِ قاعدةٍ —
 *   وهم كثيرٌ: `USER_NOT_FOUND` و`NOT_A_DRIVER` وكلُّ خطأٍ محكومٍ في RPC.
 * الحاكم: docs/adr/0122-a-deferred-query-is-not-a-promise.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 * وسمُ `sql` في `postgres.js` يبني **كائنَ استعلامٍ مُرجَأً**: لا يُرسَلُ إلى
 * القاعدةِ إلّا حينَ يُنادى `then` عليه. ومُطابِقُ `expect(…).rejects` في
 * `bun:test` لا يُناديه — فلا يُرسَلُ الاستعلامُ، ولا يُحسَمُ الوعدُ، ولا يسقطُ
 * الاختبارُ: **يتوقّفُ الملفُّ عندَ تلكَ الحالةِ إلى الأبدِ**.
 *
 * وقد دُفِعَ الثمنُ في البندِ `F3-07`: حالتانِ في
 * `tests/integration/driver-vehicle.test.ts` مرَّرَتا وسمَ `sql` خامّاً إلى
 * `expect(…).rejects`، فعلَّقَتا وظيفةَ «تكامل على PostgreSQL حقيقي» أكثرَ من
 * ساعةٍ **بلا رسالةِ فشلٍ ولا سطرٍ في السجلِّ** — وهوَ أسوأُ من الأحمرِ، إذ
 * الأحمرُ يقولُ أين. ولم يُكشَف إلّا بمسحِ كلِّ ملفٍّ بمهلةٍ قسراً.
 *
 * والبديلُ الصادقُ: مرِّر **وعداً منطلقاً** — نتيجةَ نداءِ دالّةٍ غيرِ متزامنةٍ
 * (`await expect(updateVehicle(…)).rejects.toThrow(/…/)`) أو التقِط الخطأَ
 * بـ `try`/`catch` وقِس رسالتَه.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمنعُ `await sql\`…\`` في جسمِ الاختبارِ**: الانتظارُ يُنادي `then`
 *    فيُرسَلُ الاستعلامُ ويُحسَمُ الوعدُ — وهوَ الاستخدامُ الصحيحُ الأغلبُ.
 * ــ **لا يقتصرُ على وسمِ `sql`**: كلُّ وسمِ قالبٍ داخلَ `expect(…)` ممنوعٌ،
 *    إذ الإرجاءُ صفةُ الوسمِ لا اسمِه، ولا حاجةَ لقياسِ نيّةِ المؤلِّفِ.
 * ــ **لا يمسُّ شيئاً خارجَ ملفّاتِ الاختبارِ**: `expect` لا معنى له سواها.
 * ــ **لا يُصلِحُ آلياً**: الدالّةُ البديلةُ قرارُ مؤلِّفِ الاختبارِ، والتخمينُ
 *    ههنا يُنتِجُ اختباراً يمرُّ بلا أن يقيسَ.
 */

import { toPosixPath } from "./repo-path.ts";

/** جذورُ الاختباراتِ المفحوصةُ — لا سواها، إذ `expect` لا يعملُ خارجَها. */
export const TEST_ROOTS: readonly string[] = ["tests"];

/**
 * ملفُّ السالباتِ المزروعةِ وحدَه: واجبُهُ أن يحملَ النمطَ الممنوعَ نصّاً —
 * ومنهُ **الحالةُ التي علَّقَت CI بالفعلِ في `F3-07`** — وإلّا لم يُقَسِ الحاجزُ.
 */
export const PLANTED_NEGATIVE_FILES: ReadonlySet<string> = new Set([
  "tests/unit/check-lazy-query-assertion.test.ts",
]);

export interface LazyQueryViolation {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
}

/**
 * يمحو تعليقاتِ JavaScript مع الحفاظِ على عددِ الأسطرِ ليصدُقَ رقمُ السطرِ.
 * ولا يُعالِجُ القوالبَ ولا النصوصَ: النمطُ المفحوصُ لا يقعُ داخلَها إلّا في
 * ملفِّ السالباتِ المزروعةِ — وهوَ مُستثنىً بالاسمِ.
 */
function blankJsComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    "\n".repeat((block.match(/\n/g) ?? []).length),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/**
 * `expect(` ثمَّ فراغٌ ثمَّ **معرِّفٌ** (أو وصولُ حقلٍ) ثمَّ **علامةُ قالبٍ**:
 * ذلكَ وسمُ قالبٍ مُرجَأٌ لا وعدٌ. ولا يُطابِقُ `expect(await sql\`…\`)` إذ
 * `await` كلمةٌ محجوزةٌ تُستبعَدُ صراحةً، ولا `expect(f(…))` إذ بعدَ المعرِّفِ
 * قوسٌ لا علامةُ قالبٍ.
 */
const LAZY_TAG_IN_EXPECT = /expect\(\s*(?!await\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*`/g;

/**
 * يقرأُ نصَّ ملفِّ اختبارٍ ويردُّ خرقَه. دالّةٌ خالصةٌ: الاختبارُ يزرعُ نصّاً ولا
 * يحتاجُ قرصاً — وبلا ذلكَ يصيرُ قياسُ الحاجزِ رهنَ ما يصادفُه في المستودَعِ (ح-٧).
 */
export function lazyQueryViolationsIn(file: string, source: string): readonly LazyQueryViolation[] {
  if (PLANTED_NEGATIVE_FILES.has(toPosixPath(file))) return [];
  const code = blankJsComments(source);
  const found: LazyQueryViolation[] = [];

  for (const match of code.matchAll(LAZY_TAG_IN_EXPECT)) {
    const index = match.index ?? 0;
    const tag = match[1] ?? "(وسمٌ بلا اسمٍ مقروءٍ)";
    // سطرُ الخرقِ هوَ سطرُ **الوسمِ نفسِه** لا سطرُ `expect(`: الداعيةُ
    // تُكتبُ غالباً على أسطرٍ، ومن يُصلِحُ يُريدُ الموضعَ الممنوعَ
    // لا مطلعَ التعبيرِ، ورقمُ سطرٍ خاطئٌ يُهمَلُ كما تُهمَلُ رسالةٌ غامضةٌ.
    const tagOffset = match[0].indexOf(tag, "expect(".length);
    const tagIndex = index + (tagOffset === -1 ? 0 : tagOffset);
    found.push({
      file,
      line: code.slice(0, tagIndex).split("\n").length,
      tag,
    });
  }

  return found;
}

/** رسالةُ الخرقِ — تقولُ البديلَ لا العيبَ وحدَه. */
export function describeLazyQueryViolation(violation: LazyQueryViolation): string {
  return [
    `${violation.file}:${String(violation.line)}: expect(${violation.tag}\`…\`)`,
    "      وسمُ القالبِ مُرجَأٌ: لا يُرسَلُ حتّى يُنادى `then`، ومُطابِقُ `expect`",
    "      لا يُناديه — فالوعدُ لا يُحسَمُ أبداً ويتوقّفُ ملفُّ الاختبارِ صامتاً.",
    "      البديلُ: مرِّر وعداً منطلقاً — نتيجةَ نداءِ دالّةٍ غيرِ متزامنةٍ — أو",
    "      التقِط الخطأَ بـ `try`/`catch` وقِس رسالتَه (ADR 0122).",
  ].join("\n");
}
