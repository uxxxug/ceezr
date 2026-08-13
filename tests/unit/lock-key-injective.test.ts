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
 *
 *   والأسماء **تُستنبط من `container.ts` لا تُكتب هنا يداً**: قائمةٌ منسوخة
 *   تنزلق عن مصدرها بلا أن يفشل شيء، فيمرّ الحارس عن مهمّةٍ أُضيفت بعده —
 *   وهي أحقّ ما يُحرس لأنّ التصادم يلحق الجديد لا القديم. والمرساة
 *   `everySeconds` بعد `name` لا `name` وحده: في الملفّ حقول `name` لا تخصّ المهام.
 * الحالة: منفّذ فعلياً — حارس انحدار.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: مهمّة جديدة تدخل الحرس وحدها بمجرّد تسجيلها؛ فإن تغيّر
 *   شكل التسجيل فالأرضيّات دونه تسقط وتطلب مراجعة الاستنباط.
 */

import { describe, expect, it } from "bun:test";
import { lockKeyOf } from "../../packages/infrastructure/scheduling/advisory-lock.ts";

const CONTAINER = "apps/workers/src/container.ts";

/**
 * عدد المهام المسجَّلة يوم كُتب الحارس: سبعٌ لكل مدينة وخمسٌ للمنصّة.
 * أرضيّة لا مساواة: الزيادة مشروعة وتُفحص تلقائياً، والنقص يعني أن الاستنباط
 * عطب فصار الحارس يفحص فراغاً وهو يوهم أنه يحرس.
 */
const CITY_JOBS_AT_WRITING = 7;
const GLOBAL_JOBS_AT_WRITING = 5;

async function containerSource(): Promise<string> {
  return await Bun.file(CONTAINER).text();
}

/** بادئات المهام المسجَّلة باسمٍ لكل مدينة، مقروءةً من الكود. */
function cityJobPrefixes(source: string): readonly string[] {
  return [...source.matchAll(/name: `([a-z-]+):\$\{cityId\}`,\s*\n\s*everySeconds:/g)].map(
    (match) => match[1] ?? "",
  );
}

/** المهام المسجَّلة مرّة واحدة للمنصّة كلّها، مقروءةً من الكود. */
function globalJobNames(source: string): readonly string[] {
  return [...source.matchAll(/name: "([a-z-]+)",\s*\n\s*everySeconds:/g)].map(
    (match) => match[1] ?? "",
  );
}

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
  it("الاستنباط يجد كلّ ما يُسجّل فعلاً ولا يخترع شيئاً", async () => {
    const source = await containerSource();
    const city = cityJobPrefixes(source);
    const global = globalJobNames(source);

    expect(city.length).toBeGreaterThanOrEqual(CITY_JOBS_AT_WRITING);
    expect(global.length).toBeGreaterThanOrEqual(GLOBAL_JOBS_AT_WRITING);

    // كل اسم مستنبَط موجود في الكود حرفياً — فلا يُفحص قفلٌ لا وجود له
    for (const prefix of city) expect(source).toContain(`name: \`${prefix}:`);
    for (const name of global) expect(source).toContain(`name: "${name}"`);

    // ولا اسم مكرّر في التسجيل نفسه: مهمّتان باسمٍ واحد تتقاسمان قفلاً
    // دون تصادم تجزيئة، وأحدهما لا يعمل — وهو عين ما يحرسه هذا الملفّ
    expect([...new Set(city)].length).toBe(city.length);
    expect([...new Set(global)].length).toBe(global.length);
  });

  it("لا تصادم بين أي مهمّتين مسجَّلتين، ولو تعدّدت المدن", async () => {
    const source = await containerSource();
    const names = [
      ...globalJobNames(source),
      ...cityJobPrefixes(source).flatMap((prefix) => cityIds(50).map((id) => `${prefix}:${id}`)),
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

  it("المفتاح يبقى داخل int4 بإشارة كما تتوقّعه القاعدة", async () => {
    for (const name of globalJobNames(await containerSource())) {
      const key = lockKeyOf(name);
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(key).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
});
