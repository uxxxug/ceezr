/**
 * الغرض: تهيئةُ قاعدة القياس مرّةً واحدة — ما لا يُعاد في كلّ تشغيل.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/verify-foundation.ts و bench/runner.ts
 * ملاحظات مستقبلية: أيّ قيدِ تفعيلٍ جديدٍ في `cities` يُضاف هنا لا في البذر.
 *
 * ## الفرقُ بين التهيئة والبذر، ولماذا اكتُشف متأخّراً
 *
 * كان البذرُ سيُفعّل المدنَ بنفسه، حتى أخفق على قاعدةٍ مُرحَّلةٍ نظيفة: الترحيلاتُ
 * تبذر خمسَ مدنٍ **غيرَ مُفعَّلة**، وقيدُ `cities_active_requires_groups` يمنع
 * تفعيلَ مدينةٍ بلا قروباتها الثلاثة. وهذا اكتشافٌ نافع: تفعيلُ مدينةٍ عملٌ
 * تشغيليٌّ حقيقيّ (له سكربتُه في `scripts/activate-launch-cities.ts`)، لا حالةٌ
 * ابتدائيّةٌ يفترضها أحد.
 *
 * وموضعُه الصحيح **التهيئة** لا البذر، وذلك لسببٍ يمسّ صحّةَ القياس: `cities`
 * جدولٌ تملكه الترحيلاتُ فلا يمحوه `reset`. فلو فعّله البذرُ لكان يُغيّر جدولاً
 * محفوظاً في كلّ دورة، فيصير سؤال «هل بدأ التشغيلان من الحالة نفسها؟» بلا جواب
 * نظيف. فالتهيئةُ تجري مرّةً، وتُصوَّر في كلّ تجربة ضمن الحالة المحفوظة، ويُقارَن
 * تطابقُها كما يُقارَن سائرُ الحالة.
 */

import type { Sql } from "../../../packages/infrastructure/db/client.ts";
import { assertConnectedToBenchDatabase } from "./isolation.ts";

/**
 * معرّفاتُ قروبات تيليجرام للمدن المُفعَّلة في القياس.
 *
 * سالبةٌ لأن معرّفات القروبات في تيليجرام سالبة، ومُشتقّةٌ من ترتيب المدينة
 * فتكون ثابتةً بين التشغيلات. ولا تُصيب قروباً حقيقياً: النطاقُ مُصطنع، والناقلُ
 * صامتٌ في القياس على أيّ حال (وحدة 2-3).
 */
const BENCH_GROUP_ID_BASE = -100_700_000_000_000;

export interface ProvisionReport {
  readonly database: string;
  readonly totalCities: number;
  readonly activatedCities: number;
  readonly cityCodes: readonly string[];
}

/**
 * يُفعّل مدنَ القياس بضبط القروبات والتفعيل **في عبارةٍ واحدة**.
 *
 * والواحدةُ لا اثنتان لأن القيدَ يُقيّم على الصفّ بعد العبارة: ضبطُ القروبات ثم
 * التفعيل في عبارتين يمرّ، لكنّه يجعل الأداةَ تعتمد على أنّ العبارةَ الأولى نفذت
 * — وهو بالضبط العطبُ الذي وُجد له حرسٌ في CI بعد أن أسقط اختباراتٍ بترتيبِ
 * اكتشافِ الملفّات.
 */
export async function provision(sql: Sql): Promise<ProvisionReport> {
  const database = await assertConnectedToBenchDatabase(sql);

  const cities = await sql<{ id: string; code: string }[]>`
    select id, code from public.cities order by code
  `;
  if (cities.length === 0) {
    throw new Error("[bench/provision] لا مدن في القاعدة — الترحيلات لم تُطبَّق.");
  }

  let index = 0;
  for (const city of cities) {
    const base = BENCH_GROUP_ID_BASE - index * 3;
    await sql`
      update public.cities set
        telegram_support_group_id = ${base},
        telegram_escalation_group_id = ${base - 1},
        telegram_unsubscribed_drivers_group_id = ${base - 2},
        is_active = true
      where id = ${city.id}
    `;
    index += 1;
  }

  const [{ count: activeCount } = { count: "0" }] = await sql<{ count: string }[]>`
    select count(*)::text as count from public.cities where is_active = true
  `;

  return {
    database,
    totalCities: cities.length,
    activatedCities: Number(activeCount),
    cityCodes: cities.map((c) => c.code),
  };
}
