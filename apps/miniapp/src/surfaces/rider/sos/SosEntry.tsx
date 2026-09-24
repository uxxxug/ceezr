/**
 * الغرض: مدخلُ الاستغاثةِ الظاهرُ من كلِّ سطحِ راكبٍ ذي صلةٍ — زرٌّ واحدٌ
 *   مُوحَّدٌ يفتحُ شاشةَ `SosScreen`، فيكونُ البابُ في مكانِه لا في ذاكرةِ
 *   الراكبِ (البند `PD-020` · `ADR 0159`).
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: شاشاتُ الراكبِ التسعُ الملتزمةُ (`RiderRoot.tsx` يُمرِّرُ
 *   `onOpenSos` إلى كلٍّ منها)، لا الرحلةُ النشطةُ — فبطاقتُها المدمجةُ
 *   أقربُ من مدخلٍ يفتحُ شاشةً فوقَها.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لِمَ مدخلٌ مُوحَّدٌ لا زرٌّ يُرسمُه كلُّ سطحٍ بيدِه
 *
 * زرٌّ يكتبُه كلُّ سطحٍ يختلفُ في مرتبتِه ونصِّه ومساحتِ لمسِه من شاشةٍ إلى
 * شاشةٍ، والاستغاثةُ آخرُ ما يحتملُ أن يُبحثَ عنهُ. فمُكوِّنٌ واحدٌ يجعلُ
 * البابَ واحداً في كلِّ السطوحِ — والشاشاتُ تُقرِّرُ **متى يُعرَضُ** لا **كيفَ**.
 *
 * ## ولِمَ المدخلُ يفتحُ شاشةً ولا يُبلِّغُ بنفسِه
 *
 * لأنَّ البطاقةَ المُحكومةَ (ADR 0111) تقرأُ الحكمَ قبلَ الضغطِ وتُفصِحُ قبلَهُ،
 * وذاكَ شغلُ `SosScreen`. ومدخلٌ يُرسِلُ مباشرةً يَعِدُ قبلَ أن يُقرأَ الحكمُ —
 * وهوَ الكذبُ الذي مُنِعَ في `F2-10`.
 *
 * ## وما لا يفعلهُ هذا المُكوِّنُ عن قصدٍ
 *
 *   ــ **لا يقرأُ حكمًا ولا يسألُ شبكةً**: مدخلٌ صامتٌ، والسؤالُ كلُّهُ للشاشةِ.
 *   ــ **لا يَعِدُ اتّصالًا**: النصُّ يستغيثُ بفريقِ السلامةِ لا بشرطةٍ،
 *      والإفصاحُ الكاملُ في البطاقةِ لا في الزرِّ.
 *   ــ **لا موقعَ ولا رحلةَ يمرِّرُها**: الطلبُ يُحَلُّ في القاعدةِ (`ADR 0077`).
 */

import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";

export interface SosEntryProps {
  readonly language?: MiniAppLanguage | undefined;
  /** يفتحُ شاشةَ الاستغاثةِ — **واجبٌ لا اختياريٌّ**: مدخلٌ بلا فعلٍ زرٌّ صوريٌّ. */
  readonly onOpen: () => void;
}

export function SosEntry({ language = MINIAPP_DEFAULT_LANGUAGE, onOpen }: SosEntryProps) {
  const t = miniAppTranslator(language);
  return (
    <button
      type="button"
      className="sos__entry"
      dir={directionFor(language)}
      onClick={() => onOpen()}
    >
      {t("rider.sos.entry")}
    </button>
  );
}
