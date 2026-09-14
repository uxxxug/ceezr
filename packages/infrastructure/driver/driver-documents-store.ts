/**
 * الغرض: محوّلُ وثائقِ السائقِ على PostgreSQL — نداءُ الدوالِّ الأربعِ وقراءةُ
 *   حمولتِها **بلا افتراضٍ** (`F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — وثائقُ المركبةِ صفوفٌ في الجدولِ نفسِه،
 *   فلا محوِّلَ ثانياً لها.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ سببُ الحجبِ يُقرأُ ههنا ولا يُعادُ حسابُه
 *
 * القاعدةُ تحسبُ الانتهاءَ بـ`current_date` الخاصِّ بمعاملتِها، وحسابُه من
 * ساعةِ العمليّةِ يُنتِجُ حجباً يختلفُ عن حجبِ جولةِ العرضِ (`F12-14`) —
 * **فيُقالُ للسائقِ إنَّه سليمٌ وهو محجوبٌ عن العروضِ فعلاً**.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ وحدَها، والمعرّفُ
 *      يُفحَصُ رقميّاً قبلَ إرسالِه إلى `bigint`.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يُسقِطُ سبباً لا يفهمُه**: يُحصيه عدداً (`unreadableBlockReasons`)
 *      فيبقى الحجبُ ظاهراً وإن جهِلَ اسمَه هذا الإصدارُ.
 *   ــ **لا يعرفُ دلواً ولا يُوقِّعُ**: التوقيعُ في `storage/signed-upload.ts`.
 */

import type {
  DriverDocumentRejectionDetail,
  DriverDocumentSlotGrant,
  DriverDocumentStore,
  DriverDocumentStoreError,
  DriverDocumentStoreRejection,
  RecordedDriverDocument,
  SubmittedForReview,
} from "../../application/driver/ports.ts";
import {
  type DriverBlockReason,
  type DriverDocumentDashboard,
  type DriverDocumentRow,
  type DriverDocumentType,
  isDriverDocumentStatus,
  isDriverDocumentType,
  parseBlockReason,
} from "../../domain/driver/driver-documents.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

/** مجالُ الرفضِ المغلقُ — يُقابِلُ رموزَ الدوالِّ الأربعِ حرفاً. */
const REJECTIONS: readonly DriverDocumentStoreRejection[] = [
  "USER_NOT_FOUND",
  "USER_BLOCKED",
  "NOT_A_DRIVER",
  "UPLOAD_POLICY_MISSING",
  "CONTENT_TYPE_NOT_ALLOWED",
  "SIZE_NOT_POSITIVE",
  "FILE_TOO_LARGE",
  "OBJECT_PATH_NOT_MINE",
  "EXPIRY_REQUIRED",
  "EXPIRY_IN_PAST",
  "EXPIRY_TOO_FAR",
  "DOCUMENTS_INCOMPLETE",
];

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): DriverDocumentStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * قراءةُ يومٍ صِرفٍ من حمولةِ القاعدةِ. و`date` يعودُ من المُحرِّكِ إمّا نصّاً
 * `YYYY-MM-DD` وإمّا `Date` بمنتصفِ ليلٍ **محليٍّ** — فـ`toISOString` عليه
 * يُزحزِحُ اليومَ يوماً كامِلاً غربَ غرينتش. فالأجزاءُ تُقرأُ محليّاً.
 */
function readPlainDay(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, "0");
    const day = `${value.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = readText(value);
  if (text === null) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** كما في `rider-support-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function readAllowed(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const allowed: string[] = [];
  for (const item of value) {
    const text = readText(item);
    if (text !== null) allowed.push(text);
  }
  return allowed;
}

function readMissing(value: unknown): readonly DriverDocumentType[] {
  if (!Array.isArray(value)) return [];
  const missing: DriverDocumentType[] = [];
  for (const item of value) {
    // نوعٌ لا يعرفُه هذا الإصدارُ **يُهمَلُ من التسميةِ ولا يُبطِلُ الرفضَ**:
    // «ناقصٌ» صحيحٌ سواءٌ عُرِفَ اسمُه أم لا، ورمي الرفضِ كلِّه لأجلِ اسمٍ
    // يُحوِّلُ نقصاً مفهوماً إلى عطبِ خادمٍ.
    if (isDriverDocumentType(item)) missing.push(item);
  }
  return missing;
}

function rejectionFrom(payload: Record<string, unknown>): DriverDocumentStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  const rejection = code as DriverDocumentStoreRejection;
  const detail: DriverDocumentRejectionDetail = {
    rejection,
    allowedContentTypes:
      rejection === "CONTENT_TYPE_NOT_ALLOWED" ? readAllowed(payload.allowed) : [],
    maxBytes: rejection === "FILE_TOO_LARGE" ? readInteger(payload.max_bytes) : null,
    missing: rejection === "DOCUMENTS_INCOMPLETE" ? readMissing(payload.missing) : [],
  };
  return detail;
}

function readBlockReasons(
  value: unknown,
): { readonly reasons: readonly DriverBlockReason[]; readonly unreadable: number } | null {
  if (!Array.isArray(value)) return null;
  const reasons: DriverBlockReason[] = [];
  let unreadable = 0;
  for (const item of value) {
    const parsed = parseBlockReason(item);
    if (parsed === null) unreadable += 1;
    else reasons.push(parsed);
  }
  return { reasons, unreadable };
}

function readDocumentRow(value: unknown): DriverDocumentRow | null {
  if (!isRecord(value)) return null;
  const docType = value.doc_type;
  if (!isDriverDocumentType(docType)) return null;
  if (typeof value.submitted !== "boolean") return null;
  if (typeof value.expires_soon !== "boolean") return null;
  const status = value.status;
  // غيابُ الصفِّ `null`، **ولا قيمةَ سادسةَ تُقبَلُ**: حالةٌ لا يعرفُها هذا
  // الإصدارُ حمولةٌ فاسدةٌ لا صفٌّ يُعرَضُ بحالةٍ مجهولةٍ.
  if (!(status === null || isDriverDocumentStatus(status))) return null;
  const expiresAt = value.expires_at === null ? null : readPlainDay(value.expires_at);
  if (value.expires_at !== null && expiresAt === null) return null;
  const daysLeft = value.days_left === null ? null : readInteger(value.days_left);
  if (value.days_left !== null && daysLeft === null) return null;
  return {
    docType,
    submitted: value.submitted,
    status,
    expiresAt,
    daysLeft,
    expiresSoon: value.expires_soon,
    reviewNote: typeof value.review_note === "string" ? value.review_note : null,
    submittedAt: value.submitted_at === null ? null : readInstant(value.submitted_at),
    reviewedAt: value.reviewed_at === null ? null : readInstant(value.reviewed_at),
  };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresDriverDocumentStore implements DriverDocumentStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async requestSlot(input: {
    readonly telegramUserId: string;
    readonly docType: DriverDocumentType;
    readonly contentType: string;
    readonly sizeBytes: number;
  }): Promise<Result<DriverDocumentSlotGrant, DriverDocumentStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_document_upload_slot(
          ${telegramId}::bigint,
          ${input.docType}::driver_document_type,
          ${input.contentType}::text,
          ${input.sizeBytes}::bigint
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const driverId = readText(payload.driver_id);
    const objectPath = readText(payload.object_path);
    const contentType = readText(payload.content_type);
    const maxBytes = readInteger(payload.max_bytes);
    const ttlSeconds = readInteger(payload.ttl_seconds);
    const docType = payload.doc_type;
    if (
      driverId === null ||
      objectPath === null ||
      contentType === null ||
      maxBytes === null ||
      maxBytes <= 0 ||
      ttlSeconds === null ||
      ttlSeconds <= 0 ||
      !isDriverDocumentType(docType)
    ) {
      return err(failed("MALFORMED_RESULT"));
    }
    return ok({ driverId, docType, objectPath, contentType, maxBytes, ttlSeconds });
  }

  async record(input: {
    readonly telegramUserId: string;
    readonly docType: DriverDocumentType;
    readonly objectPath: string;
    readonly expiresAt: string;
  }): Promise<Result<RecordedDriverDocument, DriverDocumentStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select record_driver_document(
          ${telegramId}::bigint,
          ${input.docType}::driver_document_type,
          ${input.objectPath}::text,
          ${input.expiresAt}::date
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const documentId = readText(payload.document_id);
    const expiresAt = readPlainDay(payload.expires_at);
    const docType = payload.doc_type;
    if (
      documentId === null ||
      expiresAt === null ||
      !isDriverDocumentType(docType) ||
      payload.status !== "received" ||
      typeof payload.replaced !== "boolean"
    ) {
      return err(failed("MALFORMED_RESULT"));
    }
    return ok({ documentId, docType, status: "received", expiresAt, replaced: payload.replaced });
  }

  async submitForReview(input: {
    readonly telegramUserId: string;
  }): Promise<Result<SubmittedForReview, DriverDocumentStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select submit_driver_documents_for_review(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const submitted = readInteger(payload.submitted);
    const blocks = readBlockReasons(payload.block_reasons);
    if (submitted === null || submitted < 0 || blocks === null) {
      return err(failed("MALFORMED_RESULT"));
    }
    // **الحجبُ يُقرأُ من عددِ ما نطقَت بهِ القاعدةُ** لا من عددِ ما فُهِمَ:
    // سببٌ مجهولٌ حجبٌ قائمٌ، وإسقاطُه يقولُ «أُرسِلَت وكلُّ شيءٍ تمامٌ».
    return ok({
      submitted,
      stillBlocked: blocks.reasons.length + blocks.unreadable > 0,
    });
  }

  async readDashboard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverDocumentDashboard, DriverDocumentStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_document_dashboard(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const verificationStatus = readText(payload.verification_status);
    const warningDays = readInteger(payload.warning_days);
    const blocks = readBlockReasons(payload.block_reasons);
    if (
      verificationStatus === null ||
      warningDays === null ||
      warningDays < 0 ||
      blocks === null ||
      !Array.isArray(payload.documents) ||
      typeof payload.is_blocked !== "boolean"
    ) {
      return err(failed("MALFORMED_RESULT"));
    }

    const documents: DriverDocumentRow[] = [];
    for (const raw of payload.documents) {
      const row = readDocumentRow(raw);
      // **صفٌّ لا يُفهَمُ يُسقِطُ اللوحَ كلَّه** ولا يُحذَفُ منه بصمتٍ: لوحٌ
      // ناقصُ صفٍّ يُقرأُ «لا وثيقةَ مطلوبةً» وهو ما يُبنى عليه رفعٌ ناقصٌ.
      if (row === null) return err(failed("MALFORMED_RESULT"));
      documents.push(row);
    }

    return ok({
      verificationStatus,
      warningDays,
      documents,
      blockReasons: blocks.reasons,
      unreadableBlockReasons: blocks.unreadable,
      // حكمُ القاعدةِ يُقدَّمُ، **ويُقوّى بما قُرِئَ**: لو قالت «غيرُ محجوبٍ»
      // وفيها أسبابٌ، فالأمانُ في الحجبِ لا في تصديقِ الرايةِ.
      isBlocked: payload.is_blocked || blocks.reasons.length + blocks.unreadable > 0,
    });
  }
}
