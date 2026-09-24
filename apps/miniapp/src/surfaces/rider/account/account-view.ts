/**
 * الغرض: **مُهايئٌ رقيقٌ** لنموذجِ عرضِ حسابِ الراكبِ فوقَ اللبِّ المشتركِ —
 *   المفاتيحُ والسلوكُ كما كانا حرفاً، والمنطقُ صارَ في موضعٍ واحدٍ
 *   (`F2-11` · `SR-12` · `SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`، ومُهيَّأٌ في `SD-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `AccountScreen.tsx` · `tests/unit/data-rights.test.ts`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## ما كانَ ههنا ولمَ نُقِلَ (`ح-8`: تصحيحٌ بالإضافةِ لا محوٌ)
 *
 * كانَ في هذا المِلفِّ المنطقُ كلُّه ومعَه **نسخةٌ ثانيةٌ من مجالٍ مغلقٍ**:
 * `KNOWN_BASES` بخمسةِ أسسٍ والنطاقُ يُعلِنُ تسعةً. وقاعدةُ البياناتِ تُرسِلُ
 * في إيصالِ **كلِّ** حذفٍ سطرَ `identityBar` بأساسِ
 * `BLOCK_AND_STANDING_SURVIVE_ERASURE`، ونصُّه **مكتوبٌ في القواميسِ الثلاثةِ
 * منذُ `ADR 0113`** — ومع ذلكَ لم يُعرَضْ قطُّ، بل عُرِضَ محلَّه «سببُ إبقاءٍ
 * لا نعرفُ نصَّه بعدُ». فالنقلُ ههنا **إصلاحُ عطبٍ واقعٍ** لا ترتيبُ مِلفّاتٍ:
 * المجالُ يُقرأُ الآنَ من `packages/domain/privacy` فيستحيلُ افتراقُه.
 *
 * ## ولماذا بقيَت أسماءُ الصادراتِ كما هيَ
 *
 * لأنَّ المُهايئَ **لا يُغيِّرُ مفتاحاً ولا صنفاً ولا سلوكاً**: اختبارُ
 * `tests/unit/data-rights.test.ts` القائمُ يقيسُ هذه الأسماءَ نفسَها، وتغييرُها
 * كانَ سيجعلَ اختباراً أخضرَ يُعدَّلُ ليُوافقَ شِفرةً — وذاكَ نقضُ القياسِ.
 */

// `D-33` · `ADR 0188`: نصوصُ جزءِ `account` تُسجَّلُ معَ حزمتِه لا في `shell`.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/account.ts";
import type { ApiErasureReceipt } from "../../account/account-contract.ts";
import {
  accountViewModel,
  type ReceiptLine,
  type ReceiptView,
} from "../../account/account-view.ts";

export {
  exportSectionCount,
  isRetryableAccountError,
  toReceiptView,
} from "../../account/account-view.ts";
export type { ApiErasureReceipt, ReceiptLine, ReceiptView };

/**
 * عناصرُ `SR-12` التي لا سندَ لها في قاعدةٍ ولا حدَّ API — تُقالُ ولا تُخترَعُ
 * ولا يُوضَعُ لها زرٌّ صوريٌّ (`ح-5`). **نصُّ البندِ عشرةٌ والمبنيُّ ستّةٌ**،
 * والحدُّ يُقالُ للإنسانِ على الشاشةِ نفسِها لا في وثيقةٍ لا يقرؤها.
 */
export const RIDER_ACCOUNT_DEBT_KEYS: readonly string[] = [
  "rider.account.debt.editIdentity",
  "rider.account.debt.emergencyContact",
  "rider.account.debt.notificationPrefs",
  "rider.account.debt.editPlaces",
  "rider.account.debt.privacyView",
];

/** وصفُ سطحِ الراكبِ — **بادئةٌ ودَينٌ**، ولا سلوكَ يفترقُ. */
export const RIDER_ACCOUNT_SPEC = {
  keyPrefix: "rider.account.",
  declaredDebtKeys: RIDER_ACCOUNT_DEBT_KEYS,
} as const;

export const riderAccountView = accountViewModel(RIDER_ACCOUNT_SPEC);

export function retentionBasisKey(basis: string): string {
  return riderAccountView.retentionBasisKey(basis);
}

export function erasureRefusalKey(refusal: string): string {
  return riderAccountView.erasureRefusalKey(refusal);
}

export function exportRefusalKey(refusal: string): string {
  return riderAccountView.exportRefusalKey(refusal);
}

export function accountErrorKey(code: string): string {
  return riderAccountView.accountErrorKey(code);
}
