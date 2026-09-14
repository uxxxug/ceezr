/**
 * الغرض: شكلُ ردَّي `/v1/me/data-export` و`/v1/me/erasure` كما يقرؤهما
 *   العميلُ — أنواعٌ لا منطقٌ (البند `F2-11` · `SR-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`. حكمُ CI **غيرُ مقروءٍ** بعدُ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `account-api.ts` و`account-view.ts` و`AccountScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ (`SD-12`) — الردُّ واحدٌ.
 *
 * ## لماذا `basis` و`refusal` **نصٌّ** لا اتّحادٌ مغلقٌ
 *
 * سابقةُ `sos-contract.ts` حرفاً: هذا حدُّ شبكةٍ، وأساسُ إبقاءٍ جديدٌ يُضافُ
 * في القاعدةِ غداً يجبُ أن يُقرأَ «سببٌ لا نعرفُ نصَّه» **لا أن يُبيِّضَ شاشةَ
 * إيصالِ حذفٍ**. والمجالُ المغلقُ محفوظٌ في `packages/domain/privacy` حيثُ
 * تُقاسُ الحمولةُ قبلَ نشرِها.
 *
 * ## ولماذا `receipt` قد يكونُ `null` معَ `erased: true`
 *
 * «حُذِفَ من قبلُ»: النتيجةُ المطلوبةُ قائمةٌ والإيصالُ وثيقةُ لحظةِ الوقوعِ
 * لا تُعادُ بناءً. والمُصرِّفُ يُلزِمُ الشاشةَ بمعالجةِ الحالتَينِ.
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
    }
  | {
      readonly ok: true;
      readonly erased: true;
      readonly erasedAt: string;
      readonly receipt: ApiErasureReceipt | null;
    };
