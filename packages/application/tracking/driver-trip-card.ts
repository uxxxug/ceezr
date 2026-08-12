/**
 * الغرض: بطاقة رحلة السائق — ما يقصده الآن، ونقطتا الرحلة، ومرحلتها.
 * الحالة: منفّذ فعلياً — المرحلة ١٢. يستهلكه packages/application/bots/driver-dialog.ts.
 * ينتمي إلى: packages/application/tracking
 * يُتوقع أن يستخدمه لاحقاً: زمن الوصول المتوقّع (المرحلة ١٥) حين يُوصَل مزوّد المسارات
 *
 * ## لماذا القراءة بمعرّف السائق وحده
 *
 * لأن معرّف الرحلة القادم من العميل ليس إثباتاً للملكية (المرحلة ١). فلو أخذت
 * هذه الطبقة `tripId` من الزرّ لكان سائقٌ يُبدّل المعرّف في `callback_data`
 * يقرأ نقطة انطلاق رحلةٍ ليست له ووسمها ومقصدها — تسريبُ موقع عميلٍ آخر
 * بضغطة زرّ. والقارئ هنا لا يقبل رحلةً أصلاً: يسأل «ما رحلة هذا السائق؟»
 * فالعلاقة تُثبَت في الخادم ولا تُدَّعى من الجهاز.
 *
 * ## ولماذا `null` لا خطأ
 *
 * لأن «لا رحلة لك الآن» جوابٌ صحيح لا عطل: السائق يضغط الزرّ بعد أن أنهى،
 * أو قبل أن يُسنَد إليه شيء. ورفعُه خطأً كان سيُنتج «تعذّر تنفيذ الطلب» لمن
 * لا خطأ عنده — فيُعيد المحاولة على ما لا يتغيّر.
 */

import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { DriverTripFacts, DriverTripView } from "../../domain/tracking/driver-trip-view.ts";
import { driverTripView } from "../../domain/tracking/driver-trip-view.ts";

/** وقائع البطاقة كما تُقرأ من القاعدة: الرحلة، وآخر موقعٍ قانوني للسائق. */
export interface DriverTripCardFacts {
  readonly trip: DriverTripFacts;
  /** `null` = لم يُرسل السائق موقعاً بعد. حالةٌ واقعية لا عطل. */
  readonly driverLocation: Coordinates | null;
}

/**
 * مفتاح القراءة: **إمّا** معرّف السائق **أو** معرّف تلغرام الخاص به. كلاهما مُثبَت
 * في الخادم: الأول مقروءٌ من القاعدة، والثاني آتٍ من تحديث تلغرام الموثَّق لا
 * من حقلٍ يكتبه العميل. ولا ثالث لهما — ومعرّف الرحلة ليس منهما بحال (المرحلة ١).
 *
 * ولماذا اتحادٌ لا دالّتان؟ لأن دالّتين على نفس المصدر تتباعدان: يُصلَح شرط
 * الحالة في إحداهما ويُنسى في الأخرى، فيرى السائق بطاقةً في `/trip` ولا يراها
 * عند بدء الرحلة. والاتحاد يُبقي الاستعلام واحداً والشرط واحداً.
 */
export type DriverTripKey = { readonly driverId: string } | { readonly driverTelegramId: string };

/** قارئ البطاقة. سؤالٌ واحد بجواب واحد، ومفتاحه السائق لا الرحلة. */
export interface DriverTripCardReader {
  cardOf(key: DriverTripKey): Promise<DriverTripCardFacts | null>;
}

export interface DriverTripCardDeps {
  readonly cards: DriverTripCardReader;
}

export async function driverTripCard(
  key: DriverTripKey,
  deps: DriverTripCardDeps,
): Promise<DriverTripView | null> {
  const facts = await deps.cards.cardOf(key);
  if (facts === null) return null;
  return driverTripView(facts.trip, facts.driverLocation);
}
