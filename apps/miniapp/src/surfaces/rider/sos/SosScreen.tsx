/**
 * الغرض: شاشةُ الاستغاثةِ — **طبقةٌ فوقَ كلِّ سطحِ راكبٍ** تحفظُ ما تحتَها،
 *   تحملُ البطاقةَ المُحكومةَ وبابَ رجوعٍ صريحاً (البند `PD-020` · `ADR 0159`).
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: `RiderRoot.tsx` — أعلى الترتيبِ كلِّهِ، تُفتَحُ بصراحةٍ من
 *   المدخلِ `SosEntry` في أيِّ شاشةٍ ملتزمةٍ، لا تُفتَحُ من تلقاءِ نفسِها.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md ·
 *   docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لِمَ شاشةٌ لا زرٌّ عائمٌ عامٌّ
 *
 * زرٌّ عائمٌ فوقَ كلِّ شيءٍ يُلمَسُ بلا قصدٍ ويغطّي محتوىً مقروءاً، ولا يملكُ
 * مكاناً ثابتاً يُتعلَّمُ. والاستغاثةُ **تُفتَحُ بطلبٍ صريحٍ** من مدخلٍ في مكانِهِ
 * من كلِّ شاشةٍ، فما تحتَها يُحفَظُ كما حفِظَت شاشةُ الدعمِ ما تحتَها (`F2-12`).
 *
 * ## ولِمَ طبقةٌ **أعلى الترتيبِ كلِّهِ** وفوقَ الدعمِ
 *
 * لأنَّ فيها تأكيداً بخطوتَينِ وسرداً يُقرأُ بعدَ الإرسالِ، ورسمُ شاشةٍ أخرى
 * فوقَها بعدَ فتحِها يمحو مقصودَهما. ومَن فتحَ الاستغاثةَ ثمَّ فتحَ دعماً — لا
 * يقعُ: الدعمُ يُفتَحُ من الشاشاتِ لا من هنا، وهذه فوقَ الجميعِ حتّى يُطفِئَها
 * بنفسِهِ ببابِ الرجوعِ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تُقرِّرُ الأهليّةَ**: البطاقةُ تقرأُ الحكمَ من القاعدةِ (ADR 0111).
 *   ــ **لا تَعِدُ اتّصالًا ولا تفتحُ `tel:` ولا واتساب** (`SOS_NO_PHONE_CALL`).
 *   ــ **لا تُخفي ما تحتَها بجذرٍ بديلٍ يُمحى**: الرجوعُ يُطفِئُ الرايةَ
 *      فيظهرُ ما تحتها كما كانَ.
 */

import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { SosCard } from "./SosCard.tsx";

export interface SosScreenProps {
  readonly language?: MiniAppLanguage;
  /** يُطفِئُ الرايةَ فيظهرُ ما تحتَ الشاشةِ كما كانَ — بابُ رجوعٍ صريحٌ. */
  readonly onBack: () => void;
}

export function SosScreen({ language = MINIAPP_DEFAULT_LANGUAGE, onBack }: SosScreenProps) {
  const t = miniAppTranslator(language);
  return (
    <section className="sos__screen" dir={directionFor(language)}>
      {/*
        البطاقةُ بلا عنوانٍ مكرَّرٍ ههنا: عنوانُها `sos__title` هو عنوانُ الشاشةِ،
        وعنوانانِ بالنصِّ نفسِهِ يُقرآنِ تكراراً في قارئِ الشاشةِ (`UX-10`).
      */}
      <SosCard language={language} />
      <button type="button" className="sos__back" onClick={() => onBack()}>
        {t("rider.sos.back")}
      </button>
    </section>
  );
}
