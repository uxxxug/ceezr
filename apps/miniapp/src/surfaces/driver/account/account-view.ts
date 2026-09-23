/**
 * الغرض: **مُهايئٌ رقيقٌ** لنموذجِ عرضِ حسابِ السائقِ فوقَ اللبِّ المشتركِ —
 *   بادئةٌ ودَينٌ مُعلَنٌ، ولا منطقَ يُنسَخُ (`SD-12` · البند `F3-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`. حكمُ CI يُقرأُ بعدَ الدفعِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/account
 * يُستخدم من: `AccountScreen.tsx` · `tests/unit/account-surface.test.ts`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا مُهايئٌ لا شاشةٌ ثانيةٌ
 *
 * لأنَّ الحقَّ واحدٌ والمنفذَ واحدٌ: `GET /v1/me/data-export` و
 * `POST /v1/me/erasure` **لا يذكرانِ دوراً في عقدِهما** والدورُ يُقرأُ في
 * القاعدةِ (`ADR 0125`). فما يفترقُ بينَ السائقِ والراكبِ ههنا **نصٌّ ودَينٌ**
 * لا سلوكٌ، وشاشةٌ ثانيةٌ كانت ستُنشئَ موضعاً ثانياً يُصحَّحُ فيه إفصاحٌ واجبٌ
 * ويُنسى في أختِه.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُعلِنُ رفضاً خاصّاً بالسائقِ**: `WALLET_HAS_BALANCE` و
 *      `ROLE_NOT_SELF_ERASABLE` في **مجالِ النطاقِ** لا في سطحِ دورٍ، لأنَّ
 *      القاعدةَ قد تردُّهما لدورٍ ثالثٍ غداً.
 *   ــ **لا يُخفي دَيناً ولا يُخترِعُ زرّاً له**: أربعةُ عناصرَ من نصِّ `SD-12`
 *      لا جدولَ لها ولا حدَّ API، فتُقالُ على الشاشةِ نصّاً.
 */

import { accountViewModel } from "../../account/account-view.ts";

/**
 * عناصرُ نصِّ `SD-12` §«حسابي» التي **لا سندَ لها في قاعدةٍ ولا حدَّ API** —
 * تُقالُ ولا يُوضَعُ لها زرٌّ صوريٌّ (`ح-5`).
 *
 *   ــ `language`: تبديلُ اللغةِ **مبنيٌّ في شاشةِ ترحيبِ الراكبِ وحدَها**
 *      (`rider/welcome/WelcomeScreen.tsx`) ولا منفذَ يحفظُ تفضيلَ لغةٍ لسائقٍ.
 *   ــ `notificationPrefs`: لا جدولَ تفضيلاتٍ — والإشعارُ يُرسَلُ بحكمِ حالةٍ.
 *   ــ `region`: المنطقةُ تُقرأُ من `city_id` في صفِّ السائقِ ولا يُعدِّلُها
 *      صاحبُها بنفسِه؛ تعديلُها قرارُ تشغيلٍ لا زرُّ شاشةٍ.
 *   ــ `editIdentity`: الاسمُ والرقمُ من تيليجرامَ، ولا `PATCH /v1/me` قائمٌ.
 *
 * والمبنيُّ من نصِّ البندِ فعلاً ثلاثةٌ: **إضافةٌ إلى الشاشةِ الرئيسةِ** ·
 * **الخصوصيّةُ** (تنزيلُ البيانةِ) · **حذفُ الحسابِ**.
 */
export const DRIVER_ACCOUNT_DEBT_KEYS: readonly string[] = [
  "driver.account.debt.editIdentity",
  "driver.account.debt.notificationPrefs",
  "driver.account.debt.region",
];

export const DRIVER_ACCOUNT_SPEC = {
  keyPrefix: "driver.account.",
  declaredDebtKeys: DRIVER_ACCOUNT_DEBT_KEYS,
} as const;

export const driverAccountView = accountViewModel(DRIVER_ACCOUNT_SPEC);
