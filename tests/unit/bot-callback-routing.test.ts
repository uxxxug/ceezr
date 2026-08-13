/**
 * الغرض: لا زرّ inline بلا موجّه. كل `callback_data` يبنيه حوارُ دورٍ ما يجب أن
 *   يكون له فرعٌ في موجّه أزرار **ذلك الدور** — وإلا فالزرّ معروض على جهاز
 *   المستخدم وجوابه «لم أفهم هذه الرسالة».
 *
 *   لماذا فحصٌ بنيويّ لا سلوكيّ؟ لأن البادئة المجهولة والحمولة الخاطئة تعطيان
 *   نفس الردّ (`common.unknown_command`)، فاختبارٌ يضغط الأزرار لا يفرّق بين
 *   «لا موجّه لهذه البادئة» و«معرّف طلبٍ غير صالح». والعطب المقصود هنا هو الأول
 *   وحده: بادئة تُعاد تسميتها في بانيةِ اللوحة ويُنسى الموجّه، أو العكس.
 *
 *   والاتجاه واحد قصداً (المبنيّ ⊆ المُوجَّه): موجّهٌ لبادئةٍ لا يبنيها هذا
 *   الملفّ ليس عطباً — `unsub` مثلاً تُبنى في بطاقات غير المشتركين خارج هذا
 *   المجلّد، ومنعها هنا كان سيكسر اختباراً صحيحاً.
 * الحالة: منفّذ فعلياً — حارس انحدار.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: بادئة جديدة تُضاف في بانيةِ اللوحة وفي الموجّه معاً، فيبقى
 *   هذا الحارس صامتاً.
 */

import { describe, expect, it } from "bun:test";

const BOTS = "packages/application/bots";

/**
 * ملفات لوحاتُها مشتركة بين البوتين — لكنّ الاشتراك في الملفّ ليس اشتراكاً في
 * كل بانيةٍ فيه: `startRideKeyboard` تسكن `rating-dialog.ts` ولا يستعملها إلا
 * حوار السائق. فتُنسب بادئةُ بانيةٍ إلى دورٍ متى استوردها حوارُ ذلك الدور، لا
 * متى سكنت ملفّاً يستورده. وبغير هذا التمييز يشتكي الحارس من زرٍّ سليم.
 */
const SHARED_FILES = [
  "main-menu.ts",
  "language-dialog.ts",
  "rating-dialog.ts",
  "support-dialog.ts",
] as const;

/** بادئات تُبنى من ثابتٍ لا من نصٍّ حرفيّ — تُقرأ من الثابت نفسه لا تُكتب يداً. */
const CONSTANT_PREFIXES: Record<string, string> = {
  COMMAND_CALLBACK_PREFIX: "cmd",
  LANGUAGE_CALLBACK_PREFIX: "lang",
};

async function read(file: string): Promise<string> {
  return await Bun.file(`${BOTS}/${file}`).text();
}

/** يقسم ملفّاً إلى كتلٍ باسم الدالة المصدَّرة التي تفتحها. */
function exportedBlocks(source: string): readonly { name: string; body: string }[] {
  const marks = [...source.matchAll(/export (?:async )?function (\w+)/g)];
  return marks.map((mark, index) => ({
    name: mark[1] ?? "",
    body: source.slice(mark.index ?? 0, marks[index + 1]?.index ?? source.length),
  }));
}

/** البادئات التي يبنيها نصّ: ما قبل أول نقطتين في كل `data:` فيه. */
function emittedPrefixes(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/data:\s*[`"]([^`"]+)[`"]/g)) {
    const value = match[1];
    if (value === undefined) continue;
    // `${CONST}:...` أو `${CONST}code` — الثابت هو البادئة لا النصّ الحرفيّ
    const constant = value.match(/^\$\{([A-Z_]+)\}/);
    const prefix =
      constant?.[1] !== undefined ? CONSTANT_PREFIXES[constant[1]] : (value.split(":")[0] ?? "");
    if (prefix !== undefined && prefix.length > 0 && !prefix.includes("$")) {
      found.add(prefix);
    }
  }
  return found;
}

/** البادئات التي يوجّهها موجّه: `case "x":` و`prefix === "x"` معاً. */
function routedPrefixes(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/case "([a-z]+)":/g)) {
    const value = match[1];
    if (value !== undefined) found.add(value);
  }
  for (const match of source.matchAll(/prefix === "([a-z]+)"/g)) {
    const value = match[1];
    if (value !== undefined) found.add(value);
  }
  return found;
}

describe("لا زرّ inline بلا موجّه", () => {
  const roles = [
    { name: "السائق", dialog: "driver-dialog.ts", extra: ["driver-trip-reply.ts"] },
    { name: "العميل", dialog: "rider-dialog.ts", extra: [] as readonly string[] },
  ] as const;

  for (const role of roles) {
    it(`كل بادئة زرّ في حوار ${role.name} لها فرع في موجّهه`, async () => {
      const dialogSource = await read(role.dialog);
      const routed = routedPrefixes(dialogSource);
      const emitted = new Set<string>();
      for (const file of [role.dialog, ...role.extra]) {
        for (const prefix of emittedPrefixes(await read(file))) emitted.add(prefix);
      }
      for (const file of SHARED_FILES) {
        for (const block of exportedBlocks(await read(file))) {
          // البانية غير المستوردة في هذا الحوار لا تُعرض على هذا الدور
          if (!new RegExp(`\\b${block.name}\\b`).test(dialogSource)) continue;
          for (const prefix of emittedPrefixes(block.body)) emitted.add(prefix);
        }
      }

      // الحارس يجب أن يجد ما يفحصه: صفرُ بادئةٍ يعني أن التعبير النمطيّ عطب
      expect(emitted.size).toBeGreaterThan(5);
      expect(routed.size).toBeGreaterThan(5);

      const orphans = [...emitted].filter((prefix) => !routed.has(prefix));
      expect(orphans).toEqual([]);
    });
  }
});
