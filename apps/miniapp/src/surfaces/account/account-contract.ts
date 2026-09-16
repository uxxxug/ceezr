/**
 * الغرض: شكلُ ردَّي `/v1/me/data-export` و`/v1/me/erasure` كما يقرؤهما العميلُ —
 *   **عقدٌ واحدٌ للدورَينِ** لأنَّ المنفذَ واحدٌ لا يذكرُ دوراً (`F2-11` · `SR-12`
 *   · `SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12` (زيادةٌ على `F2-11`). حكمُ CI يُقرأُ
 *   بعدَ الدفعِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/account
 * يُستخدم من: `account-api.ts` · `account-view.ts` · `AccountRights.tsx` ·
 *   `rider/account/*` · `driver/account/*`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا `basis` و`refusal` **نصٌّ** لا اتّحادٌ مغلقٌ
 *
 * سابقةُ `sos-contract.ts` حرفاً: هذا حدُّ شبكةٍ، وأساسُ إبقاءٍ جديدٌ يُضافُ
 * في القاعدةِ غداً يجبُ أن يُقرأَ «سببٌ لا نعرفُ نصَّه» **لا أن يُبيِّضَ شاشةَ
 * إيصالِ حذفٍ**. والمجالُ المغلقُ محفوظٌ في `packages/domain/privacy` حيثُ
 * تُقاسُ الحمولةُ قبلَ نشرِها — **ومنه وحدَه يقرأُ نموذجُ العرضِ** ولا ينسخُه.
 *
 * ## ولماذا `receipt` قد يكونُ `null` معَ `erased: true`
 *
 * «حُذِفَ من قبلُ»: النتيجةُ المطلوبةُ قائمةٌ والإيصالُ وثيقةُ لحظةِ الوقوعِ
 * لا تُعادُ بناءً. والمُصرِّفُ يُلزِمُ الشاشةَ بمعالجةِ الحالتَينِ.
 *
 * ## وما زِيدَ ههنا في `SD-12`: `walletBalanceMinor` — **فجوةُ عقدٍ لا حقلٌ جديدٌ**
 *
 * البوّابةُ تنشرُه فعلاً في فرعِ الرفضِ منذُ `SD-12`
 * (`apps/gateway/src/routes/me-data-rights.ts`) وحاشيتُها تقولُ نصّاً: «الرقمُ
 * يُمرَّرُ ولا يُترجَمُ ههنا … والواجهةُ تُنسِّقُ الأصغرَ إلى مقروءٍ بلغةِ
 * صاحبِه». وعقدُ العميلِ **لم يكن يُعلِنُه**، فكانَ سائقٌ يُمنَعُ من المحوِ
 * برصيدٍ في محفظتِه ولا يُرى له رقمٌ — وهوَ عينُ ما يجعلُ المنعَ يُقرأُ تعلُّلاً.
 * وهذا **تصحيحٌ بالإضافةِ** (`ح-8`): لا حقلَ حُذِفَ ولا اسمٌ غُيِّرَ.
 */

/** سطرٌ من الإيصالِ: ماذا بقيَ، كم صفّاً، وبأيِّ أساسٍ. */
export interface ApiRetainedSection {
  readonly section: string;
  readonly rows: number;
  readonly basis: string;
}

export interface ApiErasureReceipt {
  readonly erased: Readonly<Record<string, number>>;
  readonly anonymized: Readonly<Record<string, number>>;
  readonly retained: readonly ApiRetainedSection[];
}

export interface ApiDataExportBundle {
  readonly exportedAt: string;
  readonly subject: string;
  readonly sections: Readonly<Record<string, unknown>>;
}

export type DataExportResponse =
  | { readonly ok: true; readonly exported: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly exported: true;
      readonly fileName: string;
      readonly bundle: ApiDataExportBundle;
    };

export type ErasureResponse =
  | {
      readonly ok: true;
      readonly erased: false;
      readonly refusal: string;
      /** كم رحلةً تمنعُ الحذفَ — يُعرَضُ عدداً لا «لا يمكنُ الآنَ». */
      readonly activeOrders: number;
      /**
       * رصيدُ المحفظةِ بأصغرِ وحدةٍ حينَ يكونُ المالُ هوَ المانعَ، وصفرٌ فيما
       * سواه. **اختياريٌّ في النوعِ لا في المنفذِ**: خادمٌ أقدمُ من هذه الحزمةِ
       * لا يُرسِلُه، وشاشةٌ تقرأُ `undefined` رقماً تعرضُ `NaN` على إنسانٍ
       * مُنِعَ — فالغيابُ يُعالَجُ في نموذجِ العرضِ بصفرٍ مُعلَنٍ لا يُخترَعُ.
       */
      readonly walletBalanceMinor?: number;
    }
  | {
      readonly ok: true;
      readonly erased: true;
      readonly erasedAt: string;
      readonly receipt: ApiErasureReceipt | null;
    };
