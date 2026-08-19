/**
 * الغرض: حالةُ استخدامِ زمنِ الوصول — تصل مزوّدَ التوجيه بسياسة المجال، وتُخرج
 *   حُكماً واحداً لا استثناءً ولا رقماً غامضاً.
 * الحالة: منفّذ فعلياً — المرحلة ١٥. يستهلكه packages/application/tracking/driver-trip-card.ts.
 * ينتمي إلى: packages/application/tracking
 * يُتوقع أن يستخدمه لاحقاً: زمنُ وصولٍ يُعرَض للراكب في البثّ الحيّ — ولم يُوصَل
 *   في هذه المرحلة عن قصد، والسببُ مكتوبٌ أدناه.
 *
 * ## لماذا هذه الطبقةُ موجودةٌ أصلاً
 *
 * لأنّ الوصلَ نفسه هو ما كان مفقوداً. قِيس في المرحلة ١٥ أنّ `createOsrmProvider`
 * لا يُستدعى في المستودع كلّه إلّا في ثلاثة ملفّات اختبار، وأنّ `RoutingProvider`
 * لا يُذكر خارج `packages/maps` ألبتّة. فالمزوّدُ كان مكتوباً ومُختبَراً وغيرَ
 * موصولٍ بشيء — وهو بالضبط ما يمنع اعتبارَ الميزة مكتملةً لمجرّد وجود ملفّ.
 *
 * ## وحدةٌ واحدةٌ لتحويل شكل الإحداثية
 *
 * المجال يقول `Coordinates { latitude, longitude }` وطبقةُ الخرائط تقول
 * `LatLng { lat, lng }`. والشكلان صحيحان في موضعيهما، والخطرُ في العبور بينهما:
 * قِيس بمسبارٍ فعليّ أنّ تمريرَ `{lat,lng}` إلى دالّةٍ تنتظر `{latitude,longitude}`
 * لا يُلقي خطأً بل **يُنتج `NaN` صامتاً**، لأنّ Bun يشغّل TypeScript بلا تصريف.
 * فالتحويلُ محصورٌ في `toLatLng` هنا وحدها: موضعٌ واحدٌ يُراجَع ويُختبَر، بدل
 * حرفيّاتٍ متناثرةٍ في كلّ مستهلك.
 *
 * ## ولماذا لا يُوصَل بالبثّ الحيّ للراكب في هذه المرحلة
 *
 * لأنّ البثّ يُرسل كلّ خمس ثوانٍ لكلّ رحلةٍ جارية، ونداءُ توجيهٍ في تلك الحلقة
 * يعني طلبَ شبكةٍ لكلّ رحلةٍ كلّ خمس ثوانٍ على خادم OSRM. وميزانيّةُ المزوّد
 * ٣٠٠٠ ملّي ثانيةً **إجماليّةٌ عبر محاولتين** ولم تُعاير على خادمٍ محمَّل (خطر
 * موثَّق في المرحلة ٩). فالوصلُ هناك قبل قياس الحمل (المرحلة ٢٤) يُدخل نداءَ
 * شبكةٍ غيرَ مقيسٍ في أكثرِ المسارات تردّداً. وهنا — بطاقةُ السائق — المستخدمُ
 * طلب صراحةً وينتظر جواباً، فالنداءُ واحدٌ لكلّ طلب.
 */

import type { EtaVerdict } from "../../domain/eta/index.ts";
import { estimateEta, etaNoInput, etaUnavailable } from "../../domain/eta/index.ts";
import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { LatLng, RoutingErrorKind, RoutingProvider } from "../../maps/core/index.ts";

/**
 * الجسرُ الوحيد بين شكل المجال وشكل الخرائط.
 *
 * مُصدَّرٌ ليُختبَر لا ليُنسخ: اختبارُ التحويل مباشرةً أرخصُ من اكتشاف `NaN` في
 * مسافةٍ معروضة.
 */
export function toLatLng(point: Coordinates): LatLng {
  return { lat: point.latitude, lng: point.longitude };
}

/**
 * تصنيفُ خطأ المزوّد إلى سبب امتناع.
 *
 * `no_route` يُفرَد عن سائر الأعطال لأنّه **جوابٌ صحيح** لا خلل: لا طريقَ بين
 * الموضعين. وخلطُه بالأعطال كان سيُنتج تنبيهاً تشغيلياً عن حالةٍ سليمة، أو
 * إعادةَ نداءٍ عن سؤالٍ وصل جوابُه (يُنظر `deservesRoutingRetry` في ADR 0018).
 *
 * و`invalid_request` يُصنَّف `PROVIDER_DOWN` لا `NO_ROUTE`: مدخلاتٌ مرفوضةٌ عيبُ
 * برنامجٍ يجب أن يظهر في تصنيف الأعطال، لا نتيجةً تُقال للمستخدم كأنّها طبيعية.
 */
function reasonForRoutingError(kind: RoutingErrorKind): EtaVerdict {
  return kind === "no_route" ? etaUnavailable("NO_ROUTE") : etaUnavailable("PROVIDER_DOWN");
}

export interface EstimateArrivalDeps {
  /**
   * `null` = لا مزوّدَ توجيهٍ مضبوط (`ROUTING_PROVIDER=none`).
   *
   * حقلٌ إلزاميٌّ يقبل `null` لا حقلٌ اختياريّ: الاختياريُّ يُنسى حقنُه فيظهر
   * «غير مُهيَّأ» في إنتاجٍ مضبوطٍ صحيحاً، والمُصرِّفُ لا يُنبّه. وبهذا الشكل
   * يُلزَم كلُّ مُركِّبٍ بأن يقرّر صراحةً.
   */
  readonly routing: RoutingProvider | null;
}

export interface EstimateArrivalInput {
  /** موقعُ السائق الآن. `null` = لم يُرسل موقعاً بعد. */
  readonly from: Coordinates | null;
  /** ما يقصده السائق الآن. `null` = المقصد غيرُ محدَّدٍ بعد (حالةٌ مشروعة). */
  readonly to: Coordinates | null;
}

/**
 * زمنُ الوصول من `from` إلى `to`.
 *
 * لا تُلقي أبداً: كلُّ فشلٍ يعود حُكمَ امتناعٍ مُصنَّفاً. لأنّ المستدعيَ بطاقةُ
 * رسالةٍ في تلغرام، واستثناءٌ غيرُ ملتقَطٍ هناك يمنع **كلَّ** البطاقة — أي يُخفي
 * نقطةَ الانطلاق والمسافة لأجل حقلٍ تكميليّ. فسقوطُ زمن الوصول يجب أن يبقى
 * سقوطَ زمن الوصول وحده.
 */
export async function estimateArrival(
  input: EstimateArrivalInput,
  deps: EstimateArrivalDeps,
): Promise<EtaVerdict> {
  const { from, to } = input;
  if (from === null || to === null) return etaNoInput();
  if (deps.routing === null) return etaUnavailable("NOT_CONFIGURED");

  // ولماذا `try` مع أنّ عقدَ المزوّد يعيد `Result` ولا يُلقي: العقدُ يُلزم الكودَ
  // المكتوبَ، لا طبقةَ الشبكة تحته. و`fetch` يُلقي في حالاتٍ لا يمرّ بها المسارُ
  // الملتقَط داخل المزوّد — فشلُ حلٍّ لاسمٍ، أو إجهاضٌ من الوقت التشغيلي. وقياسُ
  // هذه المرحلة أثبت أن استثناءً واحداً هنا يُسقط البطاقةَ كاملةً في تلغرام،
  // فيخسر السائقُ نقطةَ الانطلاق لأجل حقلٍ تكميليّ. فالحدُّ يُغلَق عند آخر موضعٍ
  // نملكه قبل أن يُغادر السطرُ طبقةَ التطبيق.
  let result: Awaited<ReturnType<typeof deps.routing.route>>;
  try {
    result = await deps.routing.route({
      origin: toLatLng(from),
      destination: toLatLng(to),
      profile: "driving",
    });
  } catch {
    return etaUnavailable("PROVIDER_DOWN");
  }

  if (!result.ok) return reasonForRoutingError(result.error.kind);

  const { durationSeconds, distanceMeters, snap } = result.value;
  return estimateEta({
    durationSeconds,
    distanceMeters,
    // الاتحادُ يُفكّ هنا صراحةً: `known: false` تصير `null` فتُقرأ في المجال
    // «لا أعلم». ولو كان الحقلُ رقماً اختيارياً لكان `?? 0` يعني «مُلصَقٌ تماماً».
    snapMeters: snap.known
      ? { origin: snap.originMeters, destination: snap.destinationMeters }
      : null,
  });
}
