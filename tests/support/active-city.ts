/**
 * الغرض: شرطُ «مدينةٌ مفعَّلةٌ لها منطقةُ خدمةٍ مفعَّلةٌ» يُصنَعُ ويُردُّ — لا يُستعارُ.
 * الحالة: منفّذ فعلياً — `OPS-019`.
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ تكاملٍ يزرعُ مستخدماً أو طلباً في مدينةٍ.
 * ملاحظات مستقبلية: أيُّ قيدٍ جديدٍ على تفعيلِ مدينةٍ يُستوفى ههنا وحدَه.
 *
 * ولماذا وُلد هذا الملف؟ لأنَّ ثمانيةَ ملفّاتِ تكاملٍ كانت تفتحُ `beforeAll`
 * بالاستعلامِ عينِه حرفاً:
 *
 *   select c.id from cities c
 *     join city_service_areas a on a.city_id = c.id and a.is_active
 *    where c.is_active order by c.code limit 1
 *
 * ثمَّ **تُوكِّدُ وجودَ صفٍّ**. وبذرةُ الهجراتِ تُنشئُ مدنَ الإطلاقِ الخمسَ
 * **معطَّلةً** بقرارِ `F2-05` (`is_active = false`)، ومنطقةَ خدمةٍ مفعَّلةً
 * واحدةً لـ`JED`. فالاستعلامُ **لا يجدُ شيئاً على قاعدةٍ نظيفةٍ**، ولا ينجحُ
 * إلّا إن سبقَه في الجولةِ ملفٌّ آخرُ فعَّلَ مدينةً ولم يُرجِعْها.
 *
 * وذاكَ ليسَ تقلُّباً يُحتمَلُ بل **أخضرُ زائفٌ**: خضرةُ الملفِّ رهنُ ترتيبِ
 * التشغيلِ لا صحّةِ ما يقيسُ. وقِيسَ الأثرُ لا فُرِضَ — أخفقَ
 * `driver-documents` في CI (الجولةُ `34909694080`) وأخفقَ `quote` محلّيّاً في
 * الجولةِ الكاملةِ بعدَ أن أعادَ `five-cities-launch` المدنَ إلى التعطيلِ في
 * `afterAll` الخاصِّ به. فتبديلُ الترتيبِ، أو تشغيلُ ملفٍّ منفرداً، أو تمزيقُ
 * الجولةِ على متوازياتٍ — يقلبُ الحكمَ بلا تغييرِ سطرٍ واحدٍ.
 *
 * ولماذا معينٌ واحدٌ لا إصلاحٌ في كلِّ ملفٍّ؟ لأنَّ التفعيلَ الصحيحَ **ليسَ
 * سطراً**: قيدُ `cities_active_requires_groups` يوجِبُ القروباتِ الثلاثةَ معَ
 * `is_active = true`، والدليلُ الفريدُ على `city_service_areas (city_id)
 * WHERE is_active` يمنعُ منطقتَينِ مفعَّلتَينِ لمدينةٍ. فثمانيةُ نسخٍ من هذا
 * المنطقِ ثمانيةُ مصادرِ حقيقةٍ تتعفَّنُ خلفَ أصلِها عندَ أوّلِ قيدٍ جديدٍ
 * (القاعدةُ 0.6 · أقلُّ مصادرِ حقيقةٍ). والمعينُ يجعلُ الكلفةَ سطراً واحداً،
 * والحاجزُ `scripts/check-integration-city-precondition.ts` يمنعُ عودةَ النمطِ
 * الخامِ فلا يعتمدُ الإنفاذُ على انتباهِ قارئٍ.
 *
 * ولماذا `JED` بالرمزِ لا «أوّلُ مدينةٍ»؟ لأنَّ `JED` هيَ وحدَها التي تملكُ
 * منطقةَ خدمةٍ مفعَّلةً في البذرةِ (`jed-envelope-v1`)، فاختيارُها **قياسٌ**
 * لا تفضيلٌ؛ ولأنَّ `order by … limit 1` يجعلُ هويّةَ المدينةِ المزروعِ فيها
 * **متغيّرةً** بحسبِ ما تركَه غيرُه، فيصيرُ الاختبارُ يقيسُ مدينةً لا يعرفُها.
 *
 * ولماذا `afterAll` يردُّ الحالةَ؟ لأنَّ ملفّاً يُفعِّلُ مدينةً ويتركُها
 * **يُورِّثُ لِمَن بعدَه شرطاً لم يطلُبْه**، فيُصلِحُ عطبَه ويصنعُ عطبَ سواه.
 * والردُّ محصورٌ بما بدَّلَه هذا المعينُ وحدَه: لا يُطفئُ مدينةً كانت مفعَّلةً
 * قبلَه، ولا يمحو قروباً لم يكتبْه هوَ.
 *
 * وما لا يُدَّعى: هذا معينُ **شرطٍ مسبقٍ** لا بديلٌ عن توكيدٍ. ولا يُنشئُ
 * منطقةَ خدمةٍ ولا يُبدِّلُ بذرةً ولا يُرخي قيداً — إن غابَت منطقةُ الخدمةِ
 * المفعَّلةُ أخفقَ صريحاً باسمِ ما غابَ.
 */

import type { Sql } from "../../packages/infrastructure/db/client.ts";

/**
 * رمزُ المدينةِ المزروعِ فيها. `JED` وحدَها تملكُ منطقةَ خدمةٍ مفعَّلةً في
 * البذرةِ، فهيَ الاختيارُ **المقيسُ** لا المفضَّلُ.
 */
export const SEED_CITY_CODE = "JED";

/**
 * القروباتُ الافتراضيّةُ الثلاثةُ التي يستوفي بها المعينُ قيدَ
 * `cities_active_requires_groups` حينَ لا يطلبُ المُنادي قيماً بعينِها.
 * سالبةٌ بعيدةٌ عن أيِّ قروبٍ حقيقيٍّ.
 */
export const SEED_GROUP_IDS = {
  support: -1_003_001,
  escalation: -1_003_002,
  unsubscribed: -1_003_003,
} as const;

/**
 * قروباتٌ بعينِها يطلبُها ملفٌّ **يقيسُ** معرّفَ القروبِ في توكيدٍ (كإحالةِ
 * تذكرةٍ أو تصعيدٍ). ومن لا يقيسُها لا يُمرِّرُها فيأخذُ الافتراضَ.
 */
export type CityGroupOverrides = {
  readonly support?: number | string;
  readonly escalation?: number | string;
  readonly unsubscribed?: number | string;
};

/** لقطةُ ما كانت عليهِ المدينةُ **قبلَ** النداءِ — وإليها يُردُّ حرفاً. */
type CitySnapshot = {
  readonly isActive: boolean;
  readonly support: string | null;
  readonly escalation: string | null;
  readonly unsubscribed: string | null;
};

/** ما يُعادُ إلى المُنادي: معرّفُ المدينةِ، ولقطةُ ما قبلَه. */
export type ActiveCityHandle = {
  readonly cityId: string;
  readonly wasAlreadyActive: boolean;
  readonly previous: CitySnapshot;
};

/**
 * يضمنُ مدينةً مفعَّلةً لها منطقةُ خدمةٍ مفعَّلةٌ، **صانعاً** الشرطَ إن غابَ،
 * ويُعيدُ لقطةَ ما قبلَه كي يُردَّ حرفاً في `afterAll`.
 *
 * يُنادى في `beforeAll`. ويُخفِقُ صريحاً — باسمِ ما غابَ — إن لم تكنْ في
 * القاعدةِ مدينةٌ بالرمزِ لها منطقةُ خدمةٍ مفعَّلةٌ، إذ ذاكَ عطبُ هجرةٍ أو
 * بذرةٍ لا شيءٌ يُصلِحُه اختبارٌ.
 */
export type EnsureActiveCityOptions = {
  /** قروباتٌ بعينِها يقيسُها الملفُّ في توكيدٍ. ومن لا يقيسُها لا يُمرِّرُها. */
  readonly groups?: CityGroupOverrides | undefined;
  /**
   * المِقبَضُ الذي أعادَه نداءٌ سابقٌ في الملفِّ نفسِه — إن وُجِدَ.
   *
   * ولماذا هوَ لازمٌ لا زينةٌ؟ لأنَّ سِتّاً وثلاثينَ ملفّاً تُنادي المعينَ في
   * `beforeEach` لا في `beforeAll`، فلو أعادَ كلُّ نداءٍ لقطةً جديدةً لَقرأَ
   * الثاني «مفعَّلةٌ» لقطةً — فيردُّ `afterAll` المدينةَ إلى حالةٍ **فعَّلَها
   * الاختبارُ نفسُه** ويظنُّها خطَّ الأساسِ. فتمريرُ المِقبَضِ يُبقي **أوّلَ**
   * لقطةٍ وحدَها حاكمةً، ويجعلَ تكرارَ النداءِ بلا أثرٍ على الردِّ.
   */
  readonly prior?: ActiveCityHandle | undefined;
};

export async function ensureActiveCity(
  sql: Sql,
  options?: EnsureActiveCityOptions,
): Promise<ActiveCityHandle> {
  const overrides = options?.groups;
  const [city] = await sql<
    {
      id: string;
      is_active: boolean;
      support: string | null;
      escalation: string | null;
      unsubscribed: string | null;
    }[]
  >`
    select c.id,
           c.is_active,
           c.telegram_support_group_id::text as support,
           c.telegram_escalation_group_id::text as escalation,
           c.telegram_unsubscribed_drivers_group_id::text as unsubscribed
      from cities c
      join city_service_areas a on a.city_id = c.id and a.is_active
     where c.code = ${SEED_CITY_CODE}
     limit 1
  `;
  if (city === undefined) {
    throw new Error(
      `تعذّر الزرعُ: لا مدينةَ بالرمزِ ${SEED_CITY_CODE} لها منطقةُ خدمةٍ مفعَّلةٌ — عطبُ بذرةٍ لا عطبُ اختبارٍ`,
    );
  }

  const previous: CitySnapshot = {
    isActive: city.is_active,
    support: city.support,
    escalation: city.escalation,
    unsubscribed: city.unsubscribed,
  };

  // `cities_active_requires_groups`: مدينةٌ مفعَّلةٌ بلا قروباتٍ حالةٌ
  // **ممنوعةٌ في القاعدةِ نفسِها** (`F2-05`). فالتفعيلُ يستوفي القيدَ
  // ولا يُخفِّفُه. والقيمةُ المطلوبةُ صريحةً تُكتَبُ، وما لا يُطلَبُ
  // يُبقي القائمَ إن وُجِدَ (`coalesce`) وإلّا فالافتراضُ.
  const support = overrides?.support ?? null;
  const escalation = overrides?.escalation ?? null;
  const unsubscribed = overrides?.unsubscribed ?? null;
  await sql`
    update cities
       set is_active = true,
           telegram_support_group_id = coalesce(
             ${support}::bigint, telegram_support_group_id, ${SEED_GROUP_IDS.support}),
           telegram_escalation_group_id = coalesce(
             ${escalation}::bigint, telegram_escalation_group_id, ${SEED_GROUP_IDS.escalation}),
           telegram_unsubscribed_drivers_group_id = coalesce(
             ${unsubscribed}::bigint, telegram_unsubscribed_drivers_group_id, ${SEED_GROUP_IDS.unsubscribed})
     where id = ${city.id}
  `;

  // أوّلُ لقطةٍ وحدَها هيَ خطُّ الأساسِ — وما بعدَها حالةٌ صنعَها الاختبارُ.
  const baseline = options?.prior?.previous ?? previous;
  return {
    cityId: city.id,
    wasAlreadyActive: options?.prior?.wasAlreadyActive ?? city.is_active,
    previous: baseline,
  };
}

/**
 * يردُّ المدينةَ إلى **اللقطةِ** التي قُرِئَت قبلَ النداءِ — حرفاً، لا بمحوٍ
 * أعمى ولا بمقارنةِ قيمٍ يُظَنُّ أنَّها للمعينِ.
 *
 * يُنادى في `afterAll`. وردُّ اللقطةِ أقوى من «انزعْ ما كتبتَ»: فهوَ صحيحٌ
 * ولو بدَّلَ الاختبارُ نفسُه قروباً في منتصفِه، وهوَ **مُعادُ التنفيذِ**
 * (idempotent) فلا يضرُّ نداؤه مرّتَينِ.
 */
export async function restoreCityBaseline(
  sql: Sql,
  handle: ActiveCityHandle | undefined,
): Promise<void> {
  if (handle === undefined) return;
  const { previous } = handle;
  await sql`
    update cities
       set is_active = ${previous.isActive},
           telegram_support_group_id = ${previous.support}::bigint,
           telegram_escalation_group_id = ${previous.escalation}::bigint,
           telegram_unsubscribed_drivers_group_id = ${previous.unsubscribed}::bigint
     where id = ${handle.cityId}
  `;
}
