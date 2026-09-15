/**
 * الغرض: السطحُ الجذريُّ للسائق — تُحمَّل حزمتُه **عندَ كونِ الدورِ سائقاً وحدَه**
 *   (القسم 9.4)، وذاك هو سببُ وجودِه ملفاً منفصلاً لا فرعاً في سطحٍ واحد.
 * الحالة: منفّذ فعلياً — البند `F1-05`، **وفيه اليومَ شاشةُ وثائقٍ** (`F3-01`)
 *   **ولوحُ عروضٍ وتفاصيلُ عرضٍ** (`F3-02`).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver (حزمة `driver` — القسم 9.4)
 * يُستخدم من: `routing/RoleRouter.tsx` (تحميلٌ متأخّرٌ بالدورِ)
 * يُتوقع أن يستخدمه لاحقاً: بقيّةُ شاشاتِ `F3` تُركَّب داخلَ هذا السطح.
 * ملاحظات مستقبلية: مبدّلُ التوافرِ (القسم 9.3) ليس ههنا: التوافرُ حالةُ أعمالٍ
 *   تُكتَب على الخادمِ، وكتابتُها من التطبيقِ المصغَّرِ بندٌ لاحقٌ لا `F1-05`.
 *
 * ## لِمَ الوثائقُ هيَ **أوّلُ** ما يراهُ السائقُ ولا تُخبَّأُ خلفَ قائمةٍ
 *
 * لأنَّ سائقاً غيرَ مُوَثَّقٍ **لا يصلُه عرضٌ إطلاقاً** (`F12-14`): فأيُّ شاشةٍ
 * أخرى نُصدِّرُها إليه أوّلاً تُريهِ منتَجاً معطوباً — قائمةً فارغةً بلا سببٍ.
 * وحينَ تكتملُ وثائقُه وتُقبَلُ، تصيرُ هذه الشاشةُ سطراً هادئاً لا لوحاً.
 *
 * ## وما لا يفعلُه هذا السطحُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُوجِّهُ بمسارٍ**: لا مُوجِّهَ في التطبيقِ المصغَّرِ اليومَ، والانتقالُ
 *      حالةٌ محليّةٌ. ومُوجِّهُ عناوينٍ **دَينٌ مُعلَنٌ** لا يُحتاجُ بشاشتَينِ.
 *   ــ **لا يعرضُ رحلةً نشطةً**: بندُ `SD-05` وما بعدَه.
 *
 * ## ولِمَ صارَ اللوحُ هوَ المدخلَ بعدَ `F3-02` والوثائقُ زرّاً
 *
 * لأنَّ السائقَ يفتحُ التطبيقَ **ليعملَ** لا ليُدارَ ورقُه: ولوحُ العروضِ يقولُ
 * لهُ في سطرٍ واحدٍ لِمَ لا عملَ الآنَ — محجوبٌ بوثيقةٍ أو غيرُ متوفِّرٍ أو لا
 * طلبَ قريباً — وكلُّ سببٍ منها له طريقُه من اللوحِ نفسِه. وشاشةُ الوثائقِ باقيةٌ
 * كما هيَ **بلا تغييرٍ في سلوكِها** (`ح-8`): زُيدَ مدخلٌ ولم يُنقَصْ مدخلٌ.
 *
 * ## وانتقالُ الشاشاتِ **حالةٌ محليّةٌ بمُعرِّفِ عرضٍ** لا مُوجِّهُ عناوينٍ
 *
 * ثلاثُ شاشاتٍ لا تحتاجُ مُوجِّهاً، ومُعرِّفُ العرضِ يُحمَلُ في الحالةِ لأنَّ
 * التفاصيلَ **لا تُقرأُ إلّا بمُعرِّفٍ**: شاشةٌ تُفتَحُ بلا مُعرِّفٍ ثمَّ تسألُ
 * الخادمَ «أيُّ عرضٍ؟» بابُ عطلٍ، فجُعِلَ المُعرِّفُ شرطَ فتحٍ في النوعِ نفسِه.
 */

import { useState } from "react";
import { EmptyState } from "../../system/EmptyState.tsx";
import { DocumentsScreen } from "./documents/DocumentsScreen.tsx";
import { OfferDetailScreen } from "./offers/OfferDetailScreen.tsx";
import { OffersScreen } from "./offers/OffersScreen.tsx";

type DriverView =
  | { readonly kind: "offers" }
  | { readonly kind: "offer"; readonly offerId: string }
  | { readonly kind: "documents" }
  | { readonly kind: "placeholder" };

export default function DriverRoot() {
  const [view, setView] = useState<DriverView>({ kind: "offers" });

  if (view.kind === "offers") {
    return (
      <OffersScreen
        onOpenOffer={(offerId) => setView({ kind: "offer", offerId })}
        onBack={() => setView({ kind: "documents" })}
      />
    );
  }

  if (view.kind === "offer") {
    return (
      <OfferDetailScreen
        offerId={view.offerId}
        onBack={() => setView({ kind: "offers" })}
        // القبولُ لا يفتحُ شاشةَ رحلةٍ اليومَ — الرحلةُ بندُ `SD-05`، والعودةُ
        // إلى اللوحِ **تقرأُ الحالَ من القاعدةِ** فلا تُصدِّقُ الشاشةُ نفسَها.
        onAccepted={() => setView({ kind: "offers" })}
      />
    );
  }

  if (view.kind === "documents") {
    return <DocumentsScreen onBack={() => setView({ kind: "placeholder" })} />;
  }

  return (
    <section aria-labelledby="driver-root-title">
      <h1 id="driver-root-title" style={{ margin: 0, fontSize: "1.5rem" }}>
        وَصْلة
      </h1>
      {/* `F1-07` — `UX-5`: حالةُ الفراغِ تُقال صراحةً ولا تُترَك بياضاً يُقرأ عطلاً. */}
      <EmptyState
        title="لا شيء يُعرَض بعد"
        body="شاشاتُ العملِ بنودُ F3، وهذا السطحُ فارغٌ عن قصدٍ. ووثائقُك تُدار في شاشةِ الوثائقِ، وعروضُك في لوحِ العروضِ."
      />
      <button type="button" className="dd__back" onClick={() => setView({ kind: "documents" })}>
        وثائقي
      </button>
      <button type="button" className="dof__back" onClick={() => setView({ kind: "offers" })}>
        عروضي
      </button>
    </section>
  );
}
