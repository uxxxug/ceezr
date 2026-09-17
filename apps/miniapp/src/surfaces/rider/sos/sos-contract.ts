/**
 * الغرض: شكلُ ردَّي `/v1/safety/sos` كما يقرؤهما العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F2-10` · `SR-14`).
 * الحالة: منفَّذٌ فعليّاً — البندانِ `F2-10` و`F12-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: `sos-api.ts` و`sos-view.ts` و`SosCard.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — الردُّ واحدٌ والدورُ مُركَّبٌ خادميّاً.
 *
 * ## لماذا `eligible` اتّحادٌ بحكمٍ لا حقلٌ منطقيٌّ ومعه حقولٌ اختياريّةٌ
 *
 * لأنَّ `orderId?: string` كانَ سيُغري بـ`state.orderId ?? ""` يوماً، وطلبٌ
 * فارغٌ في بلاغِ استغاثةٍ **رقمٌ يُطبَعُ في بطاقةِ فريقِ السلامةِ** فيبحثونَ عن
 * رحلةٍ لا وجودَ لها. فالمُصرِّفُ يمنعُ قراءةَ مُعرِّفٍ لم يُنشَرْ.
 *
 * ## ولماذا `reason` و`refusal` **نصٌّ** لا اتّحادٌ مغلقٌ
 *
 * هذا حدُّ شبكةٍ: سببُ منعٍ جديدٌ يُضافُ في القاعدةِ غداً يجبُ أن يُقرأَ «سببٌ
 * لا نعرفُه» **لا أن يُبيِّضَ شاشةَ الاستغاثةِ**. والمجالُ المغلقُ محفوظٌ في
 * `packages/domain/safety/sos-surface.ts` حيثُ تُقاسُ الحمولةُ قبلَ نشرِها.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا موقعَ ولا هويّةَ سائقٍ**: الإفصاحُ يقولُ ماذا يُرسَلُ ولا يعرضُه.
 *   ــ **لا رقمَ هاتفٍ ولا رابطَ اتّصالٍ**: المنصّةُ لا تتّصلُ بأحدٍ.
 *   ــ **لا مالَ** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 */

/** بلاغٌ قائمٌ لهذا الطلبِ من هذا المُبلِّغِ — وعُمرُه **بساعةِ القاعدةِ**. */
export interface ApiSosIncident {
  readonly id: string;
  readonly status: string;
  readonly ageSeconds: number;
}

export type SosSurfaceResponse =
  | { readonly ok: true; readonly found: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly found: true;
      readonly eligible: false;
      readonly reason: string;
      readonly incident: ApiSosIncident | null;
      readonly disclosure: readonly string[];
    }
  | {
      readonly ok: true;
      readonly found: true;
      readonly eligible: true;
      readonly orderId: string;
      readonly origin: string;
      readonly postRideWindowMinutes: number;
      /** مصدرُ العددِ باسمِه: رقمٌ بلا مصدرٍ يُقرأُ وعداً وهوَ افتراضٌ. */
      readonly postRideWindowSource: string;
      readonly incident: ApiSosIncident | null;
      readonly disclosure: readonly string[];
    }
  /**
   * `F12-03` — جوازٌ **بلا رحلةٍ**. والمُميَّزُ `orderId: null` مكتوباً:
   * فبه يمنعُ المُصرِّفُ قراءةَ `postRideWindowMinutes` في حالٍ لا نافذةَ فيها،
   * ويُقرأُ غيابُ الرحلةِ **حكماً منشوراً** لا حقلاً منسيّاً.
   */
  | {
      readonly ok: true;
      readonly found: true;
      readonly eligible: true;
      readonly orderId: null;
      readonly origin: string;
      readonly incident: ApiSosIncident | null;
      readonly disclosure: readonly string[];
    };

export type SosTriggerResponse =
  | { readonly ok: true; readonly accepted: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly incidentId: string;
      /**
       * `false` = «بلاغُكَ الأوّلُ ما يزالُ قائماً» لا «لم يحدثْ شيءٌ». والفرقُ
       * يراهُ الضاغطُ فلا يُعيدُ الضغطَ ظنّاً أنَّ نداءَه ضاعَ.
       */
      readonly created: boolean;
    };
