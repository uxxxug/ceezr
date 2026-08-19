/**
 * الغرض: رقيبٌ يُخفق حين يُطلب تشغيل اختبارات التكامل وتغيب القاعدة، فلا يُعلَن
 *   الفحصُ أخضرَ وقد تُخطّي مسارُ SQL كلّه بصمت.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml (CI_REQUIRE_DB=1)
 * ملاحظات مستقبلية: لا يمسّ القاعدة إلا بجملة تحقّقٍ واحدة.
 *
 * ## لماذا هذا الرقيب موجود
 *
 * كل ملفّات tests/integration تستعمل النمط:
 *   `const describeIf = databaseUrl === undefined ? describe.skip : describe`
 * وهو نمطٌ صحيحٌ للتشغيل المحلّي بلا قاعدة، لكنّه في CI يُنتج أسوأ نتيجةٍ ممكنة:
 * فحصٌ أخضرُ لا يُجرّب دالّةً واحدةً من دوالّ plpgsql ولا سياسةَ RLS واحدة، ولا
 * يُثبت أنّ الهجرات تُطبَّق أصلاً. والاختبارُ المتخطَّى لا يظهر كإخفاقٍ لأحد.
 *
 * فالتخطّي يبقى مسموحاً حيث يُقصد (جهاز مطوّرٍ بلا قاعدة)، ويصير إخفاقاً حيث
 * يكون خطأً: بيئةٌ تُعلن `CI_REQUIRE_DB` أنّها تملك قاعدة.
 */

import { describe, expect, it } from "bun:test";
import { createSql } from "../../packages/infrastructure/db/client.ts";

// الفراغُ غيابٌ: متغيّرٌ مُعلَنٌ بقيمةٍ خالية لا يصلح رابطاً، وقبولُه بحجّة أنّه
// نصٌّ يُفرِغ الرقيبَ من معناه — وهذا ما أخفق فيه أوّل شكلٍ لهذا الملفّ.
const raw = process.env.TEST_DATABASE_URL;
const databaseUrl = raw === undefined || raw.trim() === "" ? undefined : raw;
const required = process.env.CI_REQUIRE_DB === "1";

describe("توفّر قاعدة الاختبارات", () => {
  it("رابط القاعدة موجودٌ حين تُعلن البيئة أنّها تملك قاعدة", () => {
    if (!required) return; // تشغيلٌ محلّيٌّ بلا قاعدة: التخطّي مقصود.
    expect(databaseUrl).not.toBeUndefined();
  });

  it("القاعدة المُعلَنة متّصلةٌ وهجراتها مُطبَّقة", async () => {
    if (!required || databaseUrl === undefined) return;
    const sql = createSql({ connectionString: databaseUrl });
    try {
      // `cities` أوّل جدولٍ في المخطّط الأساسي: وجودُه مع صفوفِه يعني أنّ
      // الهجرات طُبِّقت وبُذرت، لا أنّ القاعدة فارغةٌ ومتّصلة فحسب.
      const rows = await sql<{ count: number }[]>`select count(*)::int as count from cities`;
      expect(rows[0]?.count ?? 0).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });
});
