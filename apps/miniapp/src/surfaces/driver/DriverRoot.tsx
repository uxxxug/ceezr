/**
 * الغرض: السطحُ الجذريُّ للسائق — تُحمَّل حزمتُه **عندَ كونِ الدورِ سائقاً وحدَه**
 *   (القسم 9.4)، وذاك هو سببُ وجودِه ملفاً منفصلاً لا فرعاً في سطحٍ واحد.
 * الحالة: منفّذ فعلياً — البند `F1-05`، **وفيه اليومَ شاشةُ وثائقٍ** (`F3-01`)
 *   **ولوحُ عروضٍ وتفاصيلُ عرضٍ** (`F3-02`) **ومَهمّةٌ نشطةٌ** (`F3-03`).
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
 *   ــ **لا يعرضُ اشتراكاً**: بندُ `SD-07`.
 *
 * ## وقد صارَت شاشةُ الحسابِ ههنا بـ`SD-12` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * كانَ رأسُ هذا المِلفِّ يقولُ نصّاً: «لا يعرضُ شاشةَ حسابٍ: بندُ `SD-12`، وهوَ
 * **الموضعُ الطبيعيُّ لمدخلِ الدعمِ لاحقاً**؛ ومدخلُ اللوحِ اليومَ ليسَ بديلاً
 * عنه بل أقربُ منه إلى موضعِ الضررِ». **وذاكَ النصُّ يبقى مقروءاً ههنا لا
 * يُمحى**، وقد أُنجِزَ البندُ: الشاشةُ عضوٌ في الاتّحادِ، ومدخلُها من اللوحِ.
 *
 * **ومدخلُ الدعمِ في اللوحِ لم يُنقَلْ ولم يُنقَصْ**: الحكمُ الذي وضعَه هناكَ —
 * أنَّ بابَ الشكوى يُوضَعُ حيثُ وقعَ الضررُ — لم يُنقَضْ ببناءِ شاشةِ حسابٍ.
 * فزِيدَ مدخلٌ **ثانٍ** للدعمِ من شاشةِ الحسابِ كما أعلنَ هذا الرأسُ أنَّه
 * الموضعُ الطبيعيُّ، وبقيَ الأوّلُ. ورجوعُ شاشةِ الحسابِ إلى اللوحِ لا إلى
 * الوثائقِ: اللوحُ مدخلُ السائقِ العامِلِ.
 *
 * **وحقٌّ مبنيٌّ بلا بابٍ حقٌّ غيرُ ممنوحٍ عملاً** (القسم 9.12): `erase_my_account`
 * تحكمُ للسائقِ منذُ `SD-12` الأوّلِ وحزمةُ تنزيلِه إحدى وثلاثونَ قسماً، ولم
 * يكنْ في التطبيقِ زرٌّ يبلغُهما.
 *
 * ## وقد صارَت الحصيلةُ ههنا بـ`F3-05` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * وهيَ **مدخلٌ من اللوحِ** لا شاشةُ بدايةٍ: السائقُ يفتحُ التطبيقَ ليعملَ لا
 * ليُراجِعَ ماضيَه، وتقريرٌ يُفتَحُ أوّلاً يُزاحِمُ عرضاً يُنتظَرُ. و**لا باثَّ
 * موقعٍ معَها** خلافاً للوحِ والمَهمّةِ: قراءةُ تقريرٍ ليست عملاً يُبَثُّ فيهِ
 * موضعٌ، وبثٌّ من شاشةِ أرشيفٍ يُنفِقُ بطاريّةً بلا سببٍ.
 *
 * ## وقد صارَ بثُّ الموقعِ ههنا بـ`F3-04` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * الباثُّ يُركَّبُ في شاشتَي اللوحِ والمَهمّةِ **لأنَّ حالَ البثِّ حالُ السائقِ لا
 * حالُ شاشةٍ**: متاحٌ في اللوحِ يبثُّ، وفي رحلةٍ عادَ إلى اللوحِ يبثُّ. وشاشةُ
 * الوثائقِ وشاشةُ العرضِ خارجَه عن قصدٍ: أُولاهُما ورقٌ يُقرأُ مرّةً، والثانيةُ
 * قرارٌ في ثوانٍ لا يُزاحَمُ نصُّه بإعلامٍ ثانٍ.
 *
 * ## وقد صارَت الرحلةُ النشطةُ ههنا بـ`F3-03` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * القبولُ كانَ يعودُ باللوحِ لأنَّ شاشةَ المَهمّةِ لم تكن موجودةً؛ وقد وُجِدَت،
 * فصارَ القبولُ يفتحُها بمُعرِّفِ الطلبِ الذي أعادَه. وطريقُ اللوحِ باقٍ كما هوَ،
 * ومدخلُ «مَهمّتي» فيهِ لسائقٍ عادَ إلى التطبيقِ وهوَ في رحلةٍ.
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
import { AccountScreen } from "./account/AccountScreen.tsx";
import { ActivityScreen } from "./activity/ActivityScreen.tsx";
import { DocumentsScreen } from "./documents/DocumentsScreen.tsx";
import { JobScreen } from "./job/JobScreen.tsx";
import { LocationBroadcast } from "./location/LocationBroadcast.tsx";
import { OfferDetailScreen } from "./offers/OfferDetailScreen.tsx";
import { OffersScreen } from "./offers/OffersScreen.tsx";
import { SubscriptionScreen } from "./subscription/SubscriptionScreen.tsx";
import { DriverSupportScreen } from "./support/SupportScreen.tsx";
import { VehicleScreen } from "./vehicle/VehicleScreen.tsx";

type DriverView =
  | { readonly kind: "offers" }
  | { readonly kind: "offer"; readonly offerId: string }
  | { readonly kind: "job" }
  | { readonly kind: "activity" }
  | { readonly kind: "subscription" }
  | { readonly kind: "vehicle" }
  | { readonly kind: "documents" }
  | { readonly kind: "support" }
  | { readonly kind: "account" }
  | { readonly kind: "placeholder" };

export default function DriverRoot() {
  const [view, setView] = useState<DriverView>({ kind: "offers" });

  if (view.kind === "offers") {
    return (
      <>
        {/* بثُّ الموقعِ (`F3-04`) في **جذرِ السطحِ** لا في شاشةٍ: سائقٌ متاحٌ يبثُّ
            وهوَ في اللوحِ، وسائقٌ في رحلةٍ يبثُّ ولو عادَ إلى اللوحِ. ولو رُكِّبَ
            في شاشةِ المَهمّةِ لَانقطعَ البثُّ بمجرَّدِ خروجِه منها — وهوَ عطبٌ
            صامتٌ يجعلُ سائقاً يعملُ ولا يُرى موضعُه. */}
        <LocationBroadcast />
        <OffersScreen
          onOpenOffer={(offerId) => setView({ kind: "offer", offerId })}
          onOpenJob={() => setView({ kind: "job" })}
          onOpenActivity={() => setView({ kind: "activity" })}
          onOpenSubscription={() => setView({ kind: "subscription" })}
          onOpenSupport={() => setView({ kind: "support" })}
          onOpenAccount={() => setView({ kind: "account" })}
          onBack={() => setView({ kind: "documents" })}
        />
      </>
    );
  }

  if (view.kind === "offer") {
    return (
      <OfferDetailScreen
        offerId={view.offerId}
        onBack={() => setView({ kind: "offers" })}
        // القبولُ يفتحُ شاشةَ المَهمّةِ (`F3-03`)، وهيَ **تقرأُ الحالَ من
        // القاعدةِ** ولا تُصدِّقُ جوابَ القبولِ حالاً مُقيماً: مُعرِّفُ الطلبِ لا
        // يُحمَلُ في الحالةِ لأنَّ المَهمّةَ النشطةَ تُقرأُ بالرمزِ الموقَّعِ وحدَه.
        onAccepted={() => setView({ kind: "job" })}
      />
    );
  }

  if (view.kind === "job") {
    return (
      <>
        <LocationBroadcast />
        <JobScreen onBack={() => setView({ kind: "offers" })} />
      </>
    );
  }

  if (view.kind === "activity") {
    return <ActivityScreen onBack={() => setView({ kind: "offers" })} />;
  }

  if (view.kind === "subscription") {
    return <SubscriptionScreen onBack={() => setView({ kind: "offers" })} />;
  }

  if (view.kind === "vehicle") {
    return <VehicleScreen onBack={() => setView({ kind: "offers" })} />;
  }

  if (view.kind === "support") {
    // **لا `orderId` من اللوحِ**: شكوى «راكبٌ مسيءٌ» تُفتَحُ من رحلةٍ بعينِها
    // (مَهمّةٌ أو سجلُّ نشاطٍ)، ولوحُ العروضِ ليسَ رحلةً. والشاشةُ تقولُ ذلكَ
    // نصّاً لمَن اختارَ الصنفَ ههنا ولا تعرضُ حقلَ معرّفٍ يُملأُ بيدٍ.
    return <DriverSupportScreen onBack={() => setView({ kind: "offers" })} />;
  }

  if (view.kind === "account") {
    // **المدخلُ الثاني للدعمِ** من ههنا كما أعلنَ رأسُ هذا المِلفِّ أنَّه الموضعُ
    // الطبيعيُّ — والأوّلُ في اللوحِ باقٍ: مَن خُصِمَ منه مبلغٌ يشكو من موضعِ
    // الضررِ، ومَن جاءَ يسألُ عن بيانتِه يشكو من حيثُ سألَ.
    return (
      <AccountScreen
        onBack={() => setView({ kind: "offers" })}
        onOpenSupport={() => setView({ kind: "support" })}
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
      <button type="button" className="dveh__nav" onClick={() => setView({ kind: "vehicle" })}>
        مركبتي
      </button>
    </section>
  );
}
