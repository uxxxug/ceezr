/**
 * الغرض: عقدُ حقَّي البيانةِ بينَ طبقةِ التطبيقِ والقاعدةِ (`F2-11` · §9.12).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: packages/application/privacy
 * يُستخدم من: `export-my-data.ts` · `erase-my-account.ts` ·
 *   `infrastructure/privacy/data-rights-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-12` لحقِّ السائقِ — العقدُ لا يذكرُ دوراً.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## لماذا منفذٌ واحدٌ لحقَّينِ
 *
 * لأنَّ الحقَّينِ **مصدرُ حقيقتِهما واحدٌ**: سجلُّ الأحكامِ في
 * `erasure-policy.ts`. جدولٌ يُمحى ولا يُنزَّلُ خرقٌ، وجدولٌ يُنزَّلُ ولا
 * يُحكَمُ عليه عندَ الحذفِ خرقٌ. وفصلُهما في منفذَينِ يجعلُ إضافةَ جدولٍ إلى
 * أحدِهما دونَ الآخرِ سهلةً وصامتةً — وهوَ بعينِه الخرقُ.
 *
 * ## ولماذا **لا يُمرَّرُ معرّفُ مستخدمٍ داخليٌّ** ههنا
 *
 * يُمرَّرُ معرّفُ تيليجرامَ المُستخرَجُ من الرمزِ الموقَّعِ وحدَه (`F1-05`).
 * ولو قبِلَ العقدُ `userId` لصارَ حذفُ حسابِ إنسانٍ آخرَ مسافةَ حقلٍ واحدٍ في
 * جسمِ طلبٍ — وهذا أخطرُ فعلٍ غيرِ قابلٍ للنقضِ في المنصّةِ كلِّها.
 */

import type {
  DataExportBundle,
  ErasureOutcome,
  ExportRefusal,
} from "../../domain/privacy/data-rights.ts";
import type { Result } from "../../shared/result/index.ts";

/** عطبُ مخزنٍ — يُنشَرُ `503`، ولا يُخلَطُ برفضٍ مُصنَّفٍ. */
export interface DataRightsStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export type ExportVerdict =
  | { readonly exported: true; readonly bundle: DataExportBundle }
  | { readonly exported: false; readonly refusal: ExportRefusal };

export interface DataRightsStore {
  /** يقرأُ ولا يكتبُ. */
  exportMyData(input: {
    readonly telegramUserId: string;
  }): Promise<Result<ExportVerdict, DataRightsStoreFailure>>;

  /** **يكتبُ ولا يُنقَضُ** — معاملةٌ واحدةٌ في القاعدةِ، وإيصالٌ مقيسٌ. */
  eraseMyAccount(input: {
    readonly telegramUserId: string;
  }): Promise<Result<ErasureOutcome, DataRightsStoreFailure>>;
}
