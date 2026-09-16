#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ قواعدِ `DEC-18` على القرصِ — **تدهورُ الصمودِ يُقاسُ بعملِ
 *   المحرِّكِ لا بزمنِ الساعةِ**، بسقفٍ واحدٍ لا يُرفَعُ، وبلا إعادةِ تشغيلٍ حتّى
 *   يخضَرَّ. الشرحُ والقواعدُ في `scripts/lib/soak-work-measure.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ صمودٍ أو حِملٍ يُضافُ لاحقاً.
 * الحاكم: docs/adr/0130-degradation-is-measured-in-work-not-in-clock-time.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (`ح-٧`)،
 * وهذا الملفُّ قراءةُ قرصٍ وحكمُ خروجٍ. وقد مرَّ في هذا المستودَعِ حاجزٌ **أخضرُ
 * وهوَ معطوبٌ** لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه — فالفصلُ ليسَ أناقةً.
 */

import { readFile } from "node:fs/promises";
import {
  describeSoakWorkViolation,
  type GuardedFile,
  REQUIRED_FILES,
  soakWorkMeasureViolations,
} from "./lib/soak-work-measure.ts";

async function main(): Promise<void> {
  const files: GuardedFile[] = [];
  for (const path of REQUIRED_FILES) {
    try {
      files.push({ path, source: await readFile(path, "utf8") });
    } catch {
      // الغيابُ **لا يُبتلَعُ**: تُسلَّمُ القائمةُ ناقصةً فتُدينُه قاعدةُ الملفِّ
      // المحكومِ الغائبِ في المكتبةِ — فلا يُحذَفُ القياسُ بحذفِ ملفِّه.
    }
  }

  const violations = soakWorkMeasureViolations(files);
  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} ملفَّاً محكوماً: التدهورُ مقيسٌ بعملِ المحرِّكِ ` +
        `(صفوفٌ ممسوحةٌ · كُتَلٌ ملموسةٌ) بسقفٍ واحدٍ مستورَدٍ، ولا توكيدَ بزمنِ ساعةٍ ` +
        `ولا إعادةَ تشغيلٍ حتّى يخضَرَّ.`,
    );
    return;
  }

  console.error("❌ قياسُ تدهورِ الصمودِ مخروقٌ — حكمٌ بزمنِ ساعةٍ أو سقفٌ مُرخىً:\n");
  for (const violation of violations) console.error(`${describeSoakWorkViolation(violation)}\n`);
  process.exit(1);
}

await main();
