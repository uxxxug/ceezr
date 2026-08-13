/**
 * الغرض: مفتاح القفل الاستشاري يجب أن يكون متبايناً على **أسماء المهام الفعلية**
 *   لا على اسمين مختارين باليد.
 *
 *   العطب الذي يحرسه: تصادمُ `lockKeyOf` بين مهمّتين يعني أنّ إحداهما تجد القفل
 *   مأخوذاً كلَّ مرّة، فتُسجَّل `skipped_locked_elsewhere` وتُعَدّ تخطّياً مشروعاً
 *   لا فشلاً — فلا تُنبِّه أحداً ولا تعمل أبداً. وأشدّ ما يكون أثره في المهام
 *   التي لا يُفتقد أثرها فوراً: `verify-backup-restore` مثلاً لا يشتكي أحدٌ من
 *   توقّفها حتى يوم الكارثة.
 *
 *   والفضاء الحقيقي هو المهامُ مضروبةً في المدن: أكثر المهام تُسجَّل باسمٍ لكل
 *   مدينة (`expire-offers:${cityId}`)، فالتباين على أسماء المهام وحدها لا يكفي.
 *   وتُستعمل هنا معرّفات UUID واقعية الشكل بعدد يفوق مدن الإطلاق بكثير، لأنّ
 *   الغرض إثبات تباين الدالّة على هذا الشكل من المفاتيح لا حصر مدنٍ بعينها.
 * الحالة: منفّذ فعلياً — حارس انحدار.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: مهمّة جديدة تُضاف إلى `CITY_JOB_PREFIXES` أو
 *   `GLOBAL_JOB_NAMES` هنا كما تُضاف في `apps/workers/src/container.ts`.
 */

import { describe, expect, it } from "bun:test";
import { lockKeyOf } from "../../packages/infrastructure/scheduling/advisory-lock.ts";

/** بادئات المهام المسجَّلة باسمٍ لكل مدينة — مطابقة لـ`apps/workers/src/container.ts`. */
const CITY_JOB_PREFIXES = [
  "expire-offers",
  "redispatch-searching",
  "sweep-unmatched",
  "rotate-negotiations",
  "cleanup-stale",
  "reconcile-pending-payments",
  "warn-expiring",
] as const;

/** المهام المسجَّلة مرّة واحدة للمنصّة كلّها. */
const GLOBAL_JOB_NAMES = [
  "expire-subscriptions",
  "recompute-ratings",
  "backup-database",
  "verify-backup-restore",
  "deliver-safety-incidents",
] as const;

/** معرّفات بشكل UUID — العدد أكبر من مدن الإطلاق قصداً. */
function cityIds(count: number): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const tail = index.toString(16).padStart(12, "0");
    ids.push(`00000000-0000-4000-8000-${tail}`);
  }
  return ids;
}

describe("مفتاح القفل الاستشاري متباين على أسماء المهام الفعلية", () => {
  it("لا تصادم بين أي مهمّتين مسجَّلتين، ولو تعدّدت المدن", () => {
    const names = [
      ...GLOBAL_JOB_NAMES,
      ...CITY_JOB_PREFIXES.flatMap((prefix) => cityIds(50).map((id) => `${prefix}:${id}`)),
    ];

    // الحارس يجب أن يفحص فضاءً حقيقياً لا قائمةً فرغت من خطأ برمجيّ
    expect(names.length).toBeGreaterThan(300);

    const byKey = new Map<number, string>();
    const collisions: string[] = [];
    for (const name of names) {
      const key = lockKeyOf(name);
      const previous = byKey.get(key);
      if (previous !== undefined) collisions.push(`${previous} ⟷ ${name}`);
      else byKey.set(key, name);
    }

    expect(collisions).toEqual([]);
  });

  it("المفتاح يبقى داخل int4 بإشارة كما تتوقّعه القاعدة", () => {
    for (const name of GLOBAL_JOB_NAMES) {
      const key = lockKeyOf(name);
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(key).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
});
