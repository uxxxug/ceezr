/**
 * الغرض: تهيئةٌ مشتركةٌ لسيناريوهات الرحلات — سائقون حقيقيّون متاحون قربَ نقطةِ الانطلاق.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios/catalog
 * يُتوقع أن يستخدمه لاحقاً: كلُّ سيناريو يحتاج سائقاً متاحاً قبل أن يبدأ.
 * ملاحظات مستقبلية: عند تركيبِ لوحةِ الإدارة، يُستبدَل `update` التحقّقِ بمسارِها الحقيقيّ
 *                   وتُحذف مزدوجةُ ADMIN_VERIFY_MOCK من إعلانات السيناريوهات.
 */

import type { MockDeclaration, ScenarioContext } from "../contract.ts";
import type { Coordinates } from "../updates.ts";
import {
  callbackUpdate,
  contactUpdate,
  locationUpdate,
  photoUpdate,
  textUpdate,
} from "../updates.ts";

/** نقطةُ انطلاقٍ داخلَ نطاقِ جدة — مطابقةٌ لما تستعمله اختباراتُ التكامل. */
export const JED_PICKUP: Coordinates = { latitude: 21.5433, longitude: 39.1728 };

/** نطاقُ معرّفات سائقي التهيئة — منفصلٌ عن نطاقِ سيناريو التسجيل وعن نطاقِ البذر. */
export const ARRANGED_DRIVER_BASE = 910_000;
/** ونطاقُ العملاءِ الفاعلين منفصلٌ عنهما. */
export const SCENARIO_RIDER_BASE = 960_000;

export const ADMIN_VERIFY_MOCK: MockDeclaration = {
  what: "تحقّقُ الإدارةِ من السائق يُنفَّذ بتحديثٍ مباشرٍ لـ `drivers.verification_status`.",
  why: "لوحةُ الإدارة ليست مركّبةً كواجهةٍ اليوم، والتحقّقُ اليدويُّ هو ما يجري فعلاً في التشغيل الحالي.",
  proves: "أنّ ما بعد التحقّق (التوافر، البثّ، الإسناد) يعمل على المسار الحقيقيّ كاملاً.",
  doesNotProve: "مسارَ التحقّقِ الإداريَّ نفسَه: صلاحياتِه، وأثرَه المدقَّق، ورسائلَه.",
};

export interface ArrangedDriver {
  readonly chatId: number;
  readonly driverId: string;
  readonly at: Coordinates;
}

/**
 * يُسجّل سائقاً حقيقياً بالمسارِ الكامل، ثمّ يُوثّقه إداريّاً، ثمّ يُتيحه بموقعِه.
 *
 * والتسجيلُ بالمسارِ الحقيقيّ لا بإدراجٍ في الجداول: سائقٌ مُدرَجٌ بـ `insert` قد
 * ينقصه صفٌّ يُنشئه الحوارُ (قدرةٌ، مشترك)، فيصير السيناريو يقيس بثّاً على سائقٍ
 * لا يشبه سائقاً حقيقياً — وهو أسوأُ من ألّا يقيس.
 */
export async function arrangeAvailableDriver(
  context: ScenarioContext,
  index: number,
  at: Coordinates,
): Promise<ArrangedDriver> {
  const chatId = ARRANGED_DRIVER_BASE + index;
  const nationalId = `1${String(200_000_000 + index)}`;

  await context.post("driver", textUpdate(chatId, "/start"));
  await context.post("driver", textUpdate(chatId, `سائق متاح ${index + 1}`));
  await context.post("driver", contactUpdate(chatId, `05${String(40_000_000 + index)}`));
  await context.post("driver", callbackUpdate(chatId, `city:${context.cityId}`));
  await context.post("driver", callbackUpdate(chatId, "service:transport"));
  await context.post("driver", callbackUpdate(chatId, "vehicle:sedan"));
  await context.post("driver", textUpdate(chatId, `س ع د ${String(2000 + index)}`));
  await context.post("driver", textUpdate(chatId, nationalId));
  await context.post("driver", photoUpdate(chatId, `vphoto_${nationalId}`));

  const [row] = await context.sql<{ id: string }[]>`
    select d.id from public.drivers d
      join public.users u on u.id = d.user_id
     where u.telegram_id = ${chatId}
  `;
  if (row === undefined) {
    throw new Error(`[scenario/support] تعذّر تسجيلُ سائقِ التهيئة ${chatId}.`);
  }

  await context.sql`
    update public.drivers set verification_status = 'verified' where id = ${row.id}
  `;
  await context.post("driver", textUpdate(chatId, "/available"));
  await context.post("driver", locationUpdate(chatId, at));

  return { chatId, driverId: row.id, at };
}

/** يُسجّل عميلاً حقيقياً بالمسار الكامل ويعيد معرّفَه. */
export async function registerRider(
  context: ScenarioContext,
  chatId: number,
  name: string,
): Promise<string> {
  await context.post("rider", textUpdate(chatId, "/start"));
  await context.post("rider", textUpdate(chatId, name));
  await context.post("rider", callbackUpdate(chatId, `city:${context.cityId}`));

  const [row] = await context.sql<{ id: string }[]>`
    select r.id from public.riders r
      join public.users u on u.id = r.user_id
     where u.telegram_id = ${chatId}
  `;
  if (row === undefined) {
    throw new Error(`[scenario/support] تعذّر تسجيلُ العميل ${chatId}.`);
  }
  return row.id;
}

/** يُزيح إحداثيةً بمقدارٍ صغيرٍ ثابت — كي يختلف ترتيبُ القربِ بين السائقين حتماً. */
export const nudge = (at: Coordinates, index: number): Coordinates => ({
  latitude: at.latitude + 0.0025 * (index + 1),
  longitude: at.longitude + 0.0025 * (index + 1),
});
