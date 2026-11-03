/**
 * الغرض: `WR-33` — بوّابةُ «تنبيهِ التحويلاتِ الماليّةِ المسبقة»: آخرُ ما يراه الراكبُ قبلَ إرسالِ
 *   طلبٍ جديدٍ (مشوارٍ أو توصيل). زرُّ «اطلب» في نموذجِ الطلبِ لا يُرسِلُ بعدَ اليوم؛ يفتحُ هذه
 *   البوّابةَ مكانَ النموذج، والإرسالُ الفعليُّ من زرِّها «فهمت — أرسل الطلب» وحدَه.
 * الحالة: منفَّذٌ فعليًّا — `WR-33`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 *
 * ## لماذا بوّابةٌ تحلُّ محلَّ النموذج لا سطرٌ في بيانِ الدفع
 * المالكُ اشترطَ أن يكونَ التنبيهُ «واضحًا على الهاتف ولا يختفي داخلَ نصٍّ طويل». سطرٌ إضافيٌّ في
 * كتلةِ البيانِ فوقَ الزرِّ يُقرَأُ على الشاشةِ الصغيرةِ كما تُقرَأُ الشروطُ: لا يُقرَأ. البوّابةُ
 * تُفرِدُ الشاشةَ للتنبيهِ وحدَه بعنوانٍ مُعبَّأٍ ونقاطٍ قصيرة، وتنقلُ التركيزَ إلى عنوانِها، فلا
 * يُرسَلُ طلبٌ إلّا بعدَ أن مرَّ الراكبُ بها وضغطَ زرَّ الإقرار.
 *
 * ## متى تظهرُ ومتى لا
 *   - تظهرُ **لكلِّ طلبٍ جديد**: الحالةُ في `QuoteScreen` (`RequestFormModel.prepayPending`)، وكلُّ
 *     طلبٍ جديدٍ يمرُّ بـ`QuoteScreen` جديدةٍ فتبدأُ البوّابةُ مغلقةً.
 *   - لا تظهرُ أثناءَ متابعةِ الطلبِ نفسِه: الإقرارُ جزءٌ من النيّةِ التي تُسلَّمُ إلى `SearchScreen`،
 *     وكلُّ إعادةِ محاولةٍ تحملُه مع مفتاحِ اللاتكرارِ نفسِه.
 *
 * الحدود: عرضٌ فقط — لا شبكةَ ولا نصوصَ محفورة (المفاتيحُ في `rider.quote.prepay.*`).
 */

import { useEffect, useRef } from "react";
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-quote.ts";
import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";

/** مفاتيحُ النقاطِ بترتيبِ القراءة — صريحةٌ كي يراها حارسُ تغطيةِ المفاتيح. */
export const PREPAY_WARNING_LINE_KEYS = [
  "rider.quote.prepay.noAdvance",
  "rider.quote.prepay.platform",
  "rider.quote.prepay.liability",
  "rider.quote.prepay.report",
] as const;

export interface PrepayWarningGateProps {
  readonly language: MiniAppLanguage;
  /** «فهمت — أرسل الطلب»: يُسلِّمُ النيّةَ بإقرارِها. */
  readonly onConfirm: () => void;
  /** «رجوع إلى الطلب»: يُغلقُ البوّابةَ ويعودُ النموذجُ بقيمِه كما هي. */
  readonly onCancel: () => void;
}

export function PrepayWarningGate({ language, onConfirm, onCancel }: PrepayWarningGateProps) {
  const t = miniAppTranslator(language);
  const heading = useRef<HTMLHeadingElement>(null);
  // التركيزُ إلى العنوان: قارئُ الشاشةِ يبدأُ بالتنبيه، والشاشةُ تُمرَّرُ إليه إن كان النموذجُ طويلًا.
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: "start" });
  }, []);
  return (
    <section
      className="qt__prepay"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="qt-prepay-title"
      aria-describedby="qt-prepay-lines"
    >
      <h2 className="qt__prepay-title" id="qt-prepay-title" tabIndex={-1} ref={heading}>
        <span className="qt__prepay-mark" aria-hidden="true">
          !
        </span>
        {t("rider.quote.prepay.title")}
      </h2>
      <ul className="qt__prepay-lines" id="qt-prepay-lines">
        {PREPAY_WARNING_LINE_KEYS.map((key) => (
          <li key={key} className="qt__prepay-line">
            {t(key)}
          </li>
        ))}
      </ul>
      <div className="qt__prepay-actions">
        <button type="button" className="qt__prepay-confirm" onClick={onConfirm}>
          {t("rider.quote.prepay.confirm")}
        </button>
        <button type="button" className="qt__prepay-cancel" onClick={onCancel}>
          {t("rider.quote.prepay.back")}
        </button>
      </div>
    </section>
  );
}
