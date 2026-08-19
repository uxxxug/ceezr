/**
 * الغرض: مهمّةٌ دوريةٌ تسحب انقضاءَ روابط التتبّع للرحلات التي انتهت — فلا يبقى
 *   رابطٌ حيّاً بعد الرحلة إلا مهلةَ السماح المضبوطة في `platform_settings`.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه: apps/workers/src/container.ts (كلّ ٦٠ ثانية لكلّ مدينة).
 * ملاحظات مستقبلية: لو كثُرت الرموز جدّاً يُصار إلى حذفٍ أرشيفيٍّ للصفوف
 *   المنقضية قبل شهر — والحذفُ حينها للأثر لا للأمن، فالأمنُ في `expires_at`.
 *
 * ## لا منطقَ هنا ولا حساب
 *
 * الدالّة `expire_tracking_tokens` تقرأ مهلةَ السماح من إعدادات المدينة، وتحسب
 * `least(expires_at, نهايةُ الرحلة + المهلة)`، وتكتب — كلُّه في عبارةٍ ذرّية. وما
 * في هذا الملفّ نداءٌ وحدّ دفعةٍ وتقريرُ عدد.
 *
 * ## والرابطُ لا يعتمد على هذه المهمّة أمنياً
 *
 * وهذا هو الفرق الذي يجب أن يُقال: لو تعطّل العاملُ أسبوعاً فلن يبقى أيُّ رابطٍ
 * يعرض موقعاً حيّاً، لأنّ `get_tracking_position` تُخرِج `active` من **حالة الطلب**
 * وقتَ القراءة لا من صفٍّ تكتبه هذه المهمّة، ولأنّ لكلّ رمزٍ سقفَ عمرٍ مطلقاً
 * (`tracking_link_max_lifetime_minutes`) مكتوبٌ لحظةَ إصداره.
 *
 * فوظيفةُ المهمّة تضييقُ النافذة لا إنشاءُ الحدّ: بها ينتهي الرابطُ بعد الرحلة
 * بربع ساعة، وبلا ها ينتهي بانتهاء سقف عمره — ويبقى في الحالين لا يعرض حركةً
 * لأنّ الرحلة انتهت. ولو كان الأمنُ معتمداً عليها لكان عاملاً معطّلاً = روابط
 * مفتوحة، وهو ما لا يجوز أن يُبنى عليه.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { TrackingTokenRpcPort } from "../../../../packages/application/tracking/tracking-token-ports.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

/**
 * حدُّ الدفعة. تقنيٌّ لا تجاريّ: يمنع عبارةً تمسّ عشرات آلاف الصفوف في نبضةٍ
 * واحدة فتُقفل الجدول على مسار الإصدار الحيّ. وما زاد يُلحَق في النبضة التالية
 * بعد ثانيةٍ واحدة.
 */
export const TRACKING_EXPIRY_BATCH = 500;

export interface ExpireTrackingTokensDependencies {
  readonly tokens: TrackingTokenRpcPort;
}

export interface ExpireTrackingTokensReport {
  readonly cityId: CityId;
  /** عددُ الرموز التي سُحِب انقضاؤها في هذه النبضة. */
  readonly pulled: number;
}

export async function expireTrackingTokens(
  cityId: CityId,
  deps: ExpireTrackingTokensDependencies,
): Promise<Result<ExpireTrackingTokensReport, PortFailureError>> {
  const result = await deps.tokens.expireEnded(cityId, TRACKING_EXPIRY_BATCH);
  if (!result.ok) return result;
  return { ok: true, value: { cityId, pulled: result.value } };
}
