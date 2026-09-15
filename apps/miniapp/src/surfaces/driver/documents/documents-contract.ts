/**
 * الغرض: شكلُ ردودِ مساراتِ وثائقِ السائقِ كما يقرؤها العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 * يُستخدم من: `documents-api.ts` · `documents-view.ts` · `DocumentsScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — وثائقُ المركبةِ أنواعٌ في العقدِ نفسِه.
 *
 * ## لِمَ `object_path` يُعادُ من الخادمِ ويُرسَلُ كما جاءَ
 *
 * لأنَّ **القاعدةَ هيَ من سمَّاه**، والعميلُ لو بناه لبنى مساراً لا تعرفُه فتردُّه
 * القاعدةُ `OBJECT_PATH_NOT_MINE` — أو أسوأُ: يُطابِقُ بادئةَ غيرِه.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا رابطَ قراءةٍ للوثيقةِ المرفوعةِ**: دَينٌ مُعلَنٌ — اللوحُ يقولُ
 *      الحالةَ والتاريخَ لا الصورةَ.
 *   ــ **لا محادثةَ مع المراجعِ**: سببُ الرفضِ نصٌّ واحدٌ (`review_note`).
 *   ــ **لا تقدُّمَ رفعٍ بالنسبةِ المئويّةِ**: الرفعُ إلى المخزنِ مباشرةً،
 *      و`XMLHttpRequest` وحدَه يُعطي التقدُّمَ — وهذا **دَينٌ مُعلَنٌ**.
 */

/** أنواعُ الوثائقِ — **نسخةُ عرضٍ لا مصدرُ حقيقةٍ** (المصدرُ في `packages/domain`). */
export type ApiDriverDocumentType =
  | "driving_license"
  | "medical_exam"
  | "criminal_record"
  | "vehicle_registration"
  | "insurance"
  | "periodic_inspection";

export type ApiDriverDocumentStatus =
  | "received"
  | "under_review"
  | "incomplete"
  | "accepted"
  | "rejected";

export type ApiDriverBlockCode = "MISSING" | "REJECTED" | "UNVERIFIED" | "EXPIRED";

export interface ApiDriverDocumentRow {
  readonly doc_type: ApiDriverDocumentType;
  readonly submitted: boolean;
  /** `null` = لا صفَّ لها بعدُ — **غيابٌ لا حالةٌ سادسةٌ**. */
  readonly status: ApiDriverDocumentStatus | null;
  readonly expires_at: string | null;
  readonly days_left: number | null;
  readonly expires_soon: boolean;
  readonly review_note: string | null;
  readonly submitted_at: string | null;
  readonly reviewed_at: string | null;
}

export interface ApiDriverBlockReason {
  readonly code: ApiDriverBlockCode;
  readonly doc_type: ApiDriverDocumentType;
}

export interface DriverDocumentsResponse {
  readonly ok: true;
  readonly verification_status: string;
  readonly warning_days: number;
  readonly documents: readonly ApiDriverDocumentRow[];
  readonly block_reasons: readonly ApiDriverBlockReason[];
  /** عددُ أسبابٍ نطقَ بها الخادمُ ولم يفهمْها هذا الإصدارُ — **يُعرَضُ عامّاً**. */
  readonly unreadable_block_reasons: number;
  readonly is_blocked: boolean;
}

export interface DriverUploadSlotResponse {
  readonly ok: true;
  readonly doc_type: ApiDriverDocumentType;
  readonly object_path: string;
  readonly upload_url: string;
  readonly upload_token: string | null;
  readonly max_bytes: number;
  readonly expires_at: string;
}

export interface RecordDocumentResponse {
  readonly ok: true;
  readonly document_id: string;
  readonly doc_type: ApiDriverDocumentType;
  readonly status: "received";
  readonly expires_at: string;
  readonly replaced: boolean;
}

export interface SubmitDocumentsResponse {
  readonly ok: true;
  readonly submitted: number;
  readonly still_blocked: boolean;
}
