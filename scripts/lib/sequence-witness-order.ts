/**
 * الغرض: قاعدةُ حاجزٍ واحدةٌ — **لا شاهدَ يقرأُ ترتيبَ التسليمِ في اختبارٍ
 *   متزامنٍ**. أي: في ملفِّ اختبارٍ يُطلِقُ عملاً متزامناً (`Promise.all(`)،
 *   يُمنَعُ توكيدٌ واحدٌ يجمعُ **قراءةَ آخرِ عنصرٍ بالموضعِ** (`at(-1)` أو
 *   `pop()` أو `[x.length - 1]`) معَ **حالةِ الصفِّ** (`last_sequence`).
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-sequence-witness-order.ts و
 *   tests/unit/check-sequence-witness-order.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ سباقٍ على قناةِ تتبُّعٍ أو على أيِّ
 *   عدّادٍ يُمنَحُ في القاعدةِ ويُنشَرُ بعدَ المعاملةِ.
 * الحاكم: docs/adr/0147-no-delivery-order-witness-in-a-concurrent-test.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ — عطبٌ وقعَ مرّتَينِ وكُتِبَ ثلاثَ مرّاتٍ
 *
 * الرقمُ في قناةِ التتبُّعِ يُمنَحُ داخلَ `update` واحدةٍ في
 * `packages/infrastructure/tracking/session-repository.ts`، **والنشرُ يقعُ بعدَ
 * إغلاقِ المعاملةِ** في `packages/application/tracking/live-tracking.ts` وخارجَ
 * أيِّ قفلٍ. فمن نداءَينِ متزامنَينِ قد يأخذُ أحدُهما ٣ والآخرُ ٢ ثمَّ ينشرُ
 * صاحبُ ٣ أوّلاً. فتوكيدٌ يقولُ «آخرُ ما نُشِرَ = `last_sequence`» يقيسُ
 * **جدولةَ التنفيذِ** لا العقدَ، ويسقطُ بلا خللٍ في السلوكِ.
 *
 * وقد سقطَ فعلاً ثلاثَ مرّاتٍ في CI على بايتاتٍ مطابقةٍ لتشغيلاتٍ ناجحةٍ:
 * `OPS-016` (السطرُ 210 · التشغيلُ `34657801218`)، ثمَّ `OPS-017` (السطرُ 387 ·
 * التشغيلُ `34719287936`)، ثمَّ العطبُ عينُه على `main` (السطرُ 329 · التشغيلُ
 * `35431980350` · `Expected: 3 · Received: 2`). ومرّتانِ أُصلِحَتا بيدٍ بلا
 * حاجزٍ، فعادَ العطبُ في سطرٍ ثالثٍ من الملفِّ نفسِه. فالحاجزُ هوَ الفرقُ بينَ
 * إصلاحٍ وتذكُّرٍ.
 *
 * والبديلُ الصادقُ: قِسِ المجموعةَ لا الترتيبَ — `Math.max(...sequences)` يُطابِقُ
 * `last_sequence`، ولا رقمَ منشورٌ يتجاوزُه، ولا رقمَ يتكرَّرُ. وهيَ مُوجَباتٌ
 * **أقوى** لأنّها لا تُصدَّقُ بجدولةٍ محظوظةٍ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمنعُ `at(-1)` في نفسِه**: قراءةُ آخرِ عنصرٍ سليمةٌ حينَ لا تُربَطُ
 *    بحالةِ الصفِّ — كآخرِ رسالةٍ أُرسِلَت إلى مستخدمٍ.
 * ــ **لا يمسُّ الاختباراتِ المتتابعةَ**: بلا `Promise.all` ترتيبُ التسليمِ
 *    محتومٌ، وقراءتُه شاهدٌ سليمٌ (`tests/unit/tracking-sequence.test.ts`).
 * ــ **لا يقترحُ بديلاً آلياً**: صياغةُ المُوجَبِ الصادقِ قرارُ مؤلِّفِ
 *    الاختبارِ، والتخمينُ ههنا يُنتِجُ توكيداً يمرُّ بلا أن يقيسَ.
 */

import { toPosixPath } from "./repo-path.ts";

/** جذورُ الاختباراتِ المفحوصةُ — لا سواها، إذ `expect` لا يعملُ خارجَها. */
export const TEST_ROOTS: readonly string[] = ["tests"];

/**
 * ملفُّ السالباتِ المزروعةِ وحدَه: واجبُهُ أن يحملَ النمطَ الممنوعَ نصّاً —
 * ومنهُ **الأسطرُ الثلاثةُ التي أسقطَت CI فعلاً** — وإلّا لم يُقَسِ الحاجزُ.
 */
export const PLANTED_NEGATIVE_FILES: ReadonlySet<string> = new Set([
  "tests/unit/check-sequence-witness-order.test.ts",
]);

/** ما يجعلُ الملفَّ «متزامناً»: إطلاقٌ متوازٍ لا نداءٌ بعدَ نداءٍ. */
const CONCURRENT_LAUNCH = /Promise\s*\.\s*(?:all|allSettled|race|any)\s*\(/;

/** حالةُ الصفِّ التي لا يجوزُ أن تُقابَلَ بترتيبِ تسليمٍ. */
const ROW_STATE = /last_sequence/;

/** قراءةُ آخرِ عنصرٍ **بالموضعِ** — ثلاثُ صيغٍ تعني الشيءَ نفسَه. */
const POSITIONAL_LAST = [
  /\.at\(\s*-\s*1\s*\)/,
  /\.pop\(\s*\)/,
  /\[\s*[A-Za-z0-9_$.?[\]()]+\.length\s*-\s*1\s*\]/,
] as const;

export interface SequenceWitnessViolation {
  readonly file: string;
  readonly line: number;
  readonly statement: string;
}

/**
 * يمحو تعليقاتِ JavaScript مع الحفاظِ على عددِ الأسطرِ ليصدُقَ رقمُ السطرِ.
 * والنمطُ المفحوصُ لا يقعُ داخلَ نصٍّ إلّا في ملفِّ السالباتِ — وهوَ مُستثنىً
 * بالاسمِ.
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

/** هل في النصِّ قراءةُ آخرِ عنصرٍ بالموضعِ؟ */
function readsPositionalLast(text: string): boolean {
  return POSITIONAL_LAST.some((pattern) => pattern.test(text));
}

/**
 * يُجزِّئُ المصدرَ إلى «عباراتِ توكيدٍ»: من كلِّ `expect(` إلى أوّلِ `;` بعدَه.
 * والتجزيءُ بالفاصلةِ المنقوطةِ يكفي ههنا: التوكيدُ في هذا المستودَعِ عبارةٌ
 * واحدةٌ مهما تعدَّدَت أسطرُها، والحلقاتُ والدوالُّ لا تحملُ `expect(` في رأسِها.
 */
function expectStatements(source: string): readonly { text: string; line: number }[] {
  const statements: { text: string; line: number }[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes("expect(")) continue;
    let text = line;
    let cursor = index;
    while (!text.includes(";") && cursor + 1 < lines.length) {
      cursor += 1;
      text += `\n${lines[cursor] ?? ""}`;
    }
    statements.push({ text, line: index + 1 });
    index = cursor;
  }
  return statements;
}

/**
 * مُوجَبُ الحاجزِ: في ملفٍّ متزامنٍ، عبارةُ توكيدٍ واحدةٌ تجمعُ قراءةَ آخرِ
 * عنصرٍ بالموضعِ معَ `last_sequence` — بأيِّ الاتّجاهَينِ — مخالفةٌ.
 */
export function sequenceWitnessViolationsIn(
  file: string,
  source: string,
): readonly SequenceWitnessViolation[] {
  const path = toPosixPath(file);
  if (PLANTED_NEGATIVE_FILES.has(path)) return [];

  const code = blankJsComments(source);
  if (!CONCURRENT_LAUNCH.test(code)) return [];

  const violations: SequenceWitnessViolation[] = [];
  for (const statement of expectStatements(code)) {
    if (!ROW_STATE.test(statement.text)) continue;
    if (!readsPositionalLast(statement.text)) continue;
    violations.push({
      file: path,
      line: statement.line,
      statement: statement.text.trim().replace(/\s+/g, " ").slice(0, 160),
    });
  }
  return violations;
}

export function describeSequenceWitnessViolation(violation: SequenceWitnessViolation): string {
  return [
    `${violation.file}:${String(violation.line)} — شاهدٌ يقرأُ ترتيبَ التسليمِ في اختبارٍ متزامنٍ.`,
    `    ${violation.statement}`,
    "    الرقمُ يُمنَحُ في المعاملةِ ويُنشَرُ بعدَها بلا قفلٍ، فآخرُ المنشورِ ليسَ أعلاه.",
    "    البديلُ: `Math.max(...sequences)` يُطابِقُ `last_sequence`، ولا رقمَ منشورٌ يتجاوزُه.",
  ].join("\n");
}
