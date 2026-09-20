/**
 * الغرض: شاشةُ حسابِ الراكبِ (`SR-12` · البند `F2-11`) — **مُهايئٌ رقيقٌ** فوقَ
 *   اللبِّ المشتركِ، وفيها حقّا البيانةِ اللذانِ يوجبُ القسم 9.12 أن يكونا
 *   **عامِلَينِ لا زرَّينِ صوريَّينِ**.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`، ومُهيَّأٌ في `SD-12`. حكمُ CI يُقرأُ
 *   بعدَ الدفعِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `RiderRoot.tsx`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## ما في نصِّ `SR-12` **ولم يُبنَ**، ولماذا يُقالُ على الشاشةِ (الحكمُ باقٍ)
 *
 * نصُّ البندِ عشرةُ عناصرَ. المبنيُّ منها ستّةٌ، والأربعةُ الباقيةُ — الاسمُ
 * والرقمُ تعديلاً، وجهةُ اتّصالِ الطوارئِ، وتفضيلاتُ الإشعارِ — **لا جدولَ
 * لها في القاعدةِ ولا حدَّ API**. والخياراتُ كانت ثلاثةً: أن تُخترعَ جداولُ
 * لسطحٍ لم يُصمَّمْ، أو أن تُعرَضَ حقولٌ لا تُحفَظُ، أو أن يُقالَ الحدُّ.
 * والثاني أسوأُها: حقلُ «جهةُ اتّصالٍ للطوارئِ» يُملأُ ولا يُحفَظُ **وعدُ
 * سلامةٍ كاذبٌ** يُتَّكَلُ عليه في أخطرِ لحظةٍ. فالحدُّ يُقالُ للإنسانِ نصّاً
 * على الشاشةِ نفسِها، ودَينُه مكتوبٌ في `ROADMAP.md` باسمِه (`ح-5`).
 * وموضعُ قائمتِه الآنَ `account-view.ts` (`RIDER_ACCOUNT_DEBT_KEYS`) كي يقرأَها
 * الحاجزُ ساكناً ولا تبقى حبيسةَ مِلفِّ شاشةٍ.
 *
 * ## ولمَ صارَت هذه الشاشةُ سطرَينِ (`ح-8`: الحكمُ محفوظٌ والجسمُ نُقِلَ)
 *
 * كلُّ ما كانَ ههنا — كلمةُ التأكيدِ، وإفصاحُ `ADR 0113` قبلَ الضغطِ، وترتيبُ
 * الإيصالِ، وبقاءُ الإيصالِ حتّى يُغلِقَه صاحبُه — صارَ في
 * `surfaces/account/AccountRights.tsx` **بلا تغييرِ صنفٍ ولا مفتاحٍ ولا سلوكٍ**،
 * لأنَّ سطحَ السائقِ يحتاجُ الحكمَ نفسَه ونسخةٌ ثانيةٌ منه تعني إفصاحاً واجباً
 * يُصحَّحُ في شاشةٍ ويُنسى في أختِها. وقد وقعَ ذلكَ فعلاً ههنا قبلَ اليومَ:
 * انظرْ حاشيةَ `account-view.ts` في أساسِ الإبقاءِ الذي لم يُعرَضْ قطُّ.
 */

import type { MiniAppLanguage } from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import type { AccountRightsProps } from "../../account/AccountRights.tsx";
import { AccountRights } from "../../account/AccountRights.tsx";
import { SosEntry } from "../sos/SosEntry.tsx";
import { riderAccountView } from "./account-view.ts";

export interface AccountScreenProps extends Omit<AccountRightsProps, "view"> {
  readonly language?: MiniAppLanguage;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — راكبٌ وحدَهُ لا السائقُ. */
  readonly onOpenSos?: () => void;
}

export function AccountScreen(props: AccountScreenProps) {
  return (
    <AccountRights
      {...props}
      view={riderAccountView}
      // مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — يُمرَّرُ عقدةً لا يُنشَرُ
      // إلى الشاشةِ المشتركةِ علمُ الراكبِ: الدورُ يُقرَّرُ هنا لا ههناك.
      header={
        props.onOpenSos === undefined ? undefined : (
          <SosEntry onOpen={props.onOpenSos} language={props.language} />
        )
      }
    />
  );
}
