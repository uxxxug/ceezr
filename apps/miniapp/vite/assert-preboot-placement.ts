/**
 * # حاجزُ موضعِ التقديمِ الساكنِ في المُخرَجِ — `F1-09` · `DEC-19` · `D-27`
 *
 * **الغرض:** يُسقِطُ البناءَ إن لم يكن التقديمُ الساكنُ (`__waslahPreboot`) في
 * `dist/index.html` سكربتاً **كلاسيكيّاً مُضمَّناً مستقلّاً**. والسببُ مَقيسٌ: Vite طوى
 * نسخةَ الوحدةِ في وحدةِ المدخلِ بعدَ `import` الحزمِ، فلم يبدأ طلبُ الجلسةِ إلّا بعدَ
 * تنزيلِها (CI `35994981204`: 2060 ms) — واختبارُ المصدرِ مرَّ أخضرَ لأنَّ النصَّ موجودٌ.
 * فالفحصُ هنا على **المُخرَجِ** لا على المصدرِ.
 *
 * **الحالة:** مُنفَّذ · مُختبَر (`tests/unit/assert-preboot-placement.test.ts`).
 * **ينتمي إلى:** `F1-09` (الصفّانِ 4–5) · `DEC-19` · `ADR 0185` (المقياسُ لا يتغيّر).
 *
 * **ما لا يفعله:** لا يقيسُ زمناً ولا يُشغِّلُ متصفّحاً — القياسُ في وظيفةِ Slow 4G.
 */

import type { Plugin } from "vite";

const MARKER = "__waslahPreboot";

/** مخالفاتُ الموضعِ في مستندٍ مبنيٍّ؛ قائمةٌ فارغةٌ = سليمٌ. نقيّةٌ لتُختبَر. */
export function prebootPlacementViolations(html: string): string[] {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const scripts = [...source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => ({
    attributes: m[1] ?? "",
    body: m[2] ?? "",
  }));
  const carriers = scripts.filter((s) => s.body.includes(MARKER));
  const violations: string[] = [];
  if (carriers.length === 0) {
    violations.push("لا سكربتَ مُضمَّناً يحملُ التقديمَ الساكنَ في المُخرَجِ.");
  }
  for (const carrier of carriers) {
    if (/\stype=/.test(carrier.attributes)) {
      violations.push(
        `التقديمُ في سكربتٍ بـ\`${carrier.attributes.trim()}\` — المطلوبُ كلاسيكيٌّ بلا \`type\` (لا يُطوى ولا يُؤجَّل).`,
      );
    }
    if (/\bimport\s*[{*"'a-zA-Z_$]/.test(carrier.body) || /\bimport\(/.test(carrier.body)) {
      violations.push("التقديمُ مطويٌّ مع استيرادِ حزمٍ — لا يُنفَّذُ إلّا بعدَ تنزيلِها.");
    }
    if (/\sasync\b|\sdefer\b/.test(carrier.attributes)) {
      violations.push("التقديمُ مؤجَّلٌ بـ`async`/`defer`.");
    }
  }
  return violations;
}

export function assertPrebootPlacement(): Plugin {
  return {
    name: "waslah-assert-preboot-placement",
    enforce: "post",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const violations = prebootPlacementViolations(html);
        if (violations.length > 0) {
          throw new Error(
            `F1-09 · D-27: موضعُ التقديمِ الساكنِ في المُخرَجِ خاطئٌ:\n- ${violations.join("\n- ")}`,
          );
        }
        return html;
      },
    },
  };
}
