/**
 * الغرض: نموذجُ عرضِ شاشةِ وثائقِ السائقِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ والرمزَ
 *   والمِلفَّ إلى مفاتيحِ نصٍّ وقراراتٍ، بلا JSX وبلا شبكةٍ (البند `F3-01`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 * يُستخدم من: `DocumentsScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — الجدولُ عينُه بأنواعٍ أُخرى.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ الفحصُ المحليُّ للحجمِ والنوعِ **موجودٌ معَ أنَّ القاعدةَ تحكمُ**
 *
 * لأنَّ رفعَ خمسةِ ميغابايتَ على شبكةِ هاتفٍ ثمَّ رفضَه **يُهدِرُ وقتاً وبياناتٍ
 * يدفعُ ثمنَها سائقٌ**. والفحصُ ههنا **تلطُّفٌ لا سلطةٌ**: القاعدةُ تحكمُ ثانيةً،
 * وحكمُها هوَ المُلزِمُ. وحدُّه المعروضُ يأتي من الخادمِ (`max_bytes`) ولا
 * يُكتَبُ رقماً في العميلِ.
 *
 * ## ولِمَ سببُ الحجبِ يُقرأُ **رسالةً واحدةً** لا قائمةَ رموزٍ
 *
 * سائقٌ يرى `EXPIRED:insurance` **لا يعرفُ ما يُفعَلُ**. فكلُّ سببٍ يصيرُ سطرَ
 * فعلٍ على نوعِ الوثيقةِ نفسِها، وما لم يُفهَمْ رمزُه يُقالُ عامّاً ويُحصى.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُنسِّقُ تاريخاً بلغةٍ**: التنسيقُ في الشاشةِ بأداةِ المنصّةِ.
 *   ــ **لا يحسبُ «الأيّامَ الباقيةَ»**: حسابُها في القاعدةِ بساعتِها لا بساعةِ
 *      الهاتفِ — وساعةُ هاتفٍ مغلوطةٌ تُخفي انتهاءً أو تختلقُه.
 *   ــ **لا يُرتِّبُ الأولويّةَ بالمعنى**: الترتيبُ هوَ ترتيبُ الإلزامِ من
 *      القاعدةِ، وإعادةُ ترتيبٍ في العميلِ تُخفي نوعاً مطلوباً أسفلَ القائمةِ.
 */

import {
  DRIVER_DOCUMENT_TYPES,
  MAX_EXPIRY_DAYS_AHEAD,
} from "../../../../../../packages/domain/driver/driver-documents.ts";
import type {
  ApiDriverBlockReason,
  ApiDriverDocumentRow,
  ApiDriverDocumentStatus,
  ApiDriverDocumentType,
  DriverDocumentsResponse,
} from "./documents-contract.ts";

export { DRIVER_DOCUMENT_TYPES, MAX_EXPIRY_DAYS_AHEAD };

/** رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — مُقابِلةٌ لقائمةِ الخادمِ العامّةِ. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "DOCUMENT_STORE_NOT_AVAILABLE",
  "UPLOAD_NOT_AVAILABLE",
  "DOC_TYPE_UNKNOWN",
  "CONTENT_TYPE_INVALID",
  "CONTENT_TYPE_NOT_ALLOWED",
  "SIZE_INVALID",
  "FILE_TOO_LARGE",
  "OBJECT_PATH_NOT_MINE",
  "EXPIRY_REQUIRED",
  "EXPIRY_INVALID",
  "EXPIRY_IN_PAST",
  "EXPIRY_TOO_FAR",
  "DOCUMENTS_INCOMPLETE",
  "NOT_A_DRIVER",
  "ACCOUNT_BLOCKED",
  "CITY_NOT_READY",
  // رمزٌ **يولَدُ في العميلِ وحدَه**: إخفاقُ الرفعِ إلى مضيفِ المخزنِ لا يمرُّ
  // بخادمِنا فلا ينشرُه ردٌ، وله نصٌ لأنَّ السائقَ يراه فعلاً.
  "UPLOAD_FAILED",
]);

export function documentsErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code)
    ? `driver.documents.error.${code}`
    : "driver.documents.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. ورفضُ القاعدةِ للمُدخَلِ ليسَ منها:
 * إعادةٌ بالمُدخَلِ نفسِه تُردُّ الرفضَ نفسَه فيُقرأُ عطلاً.
 */
export function isRetryableDocumentsError(code: string): boolean {
  return (
    code === "DOCUMENT_STORE_NOT_AVAILABLE" ||
    code === "UPLOAD_NOT_AVAILABLE" ||
    code === "UPLOAD_FAILED" ||
    code === "UNKNOWN"
  );
}

/** نغمةُ الشارةِ — أربعُ نغماتٍ لخمسِ حالاتٍ وغيابٍ، والغيابُ نغمةٌ قائمةٌ بذاتها. */
export type DocumentTone = "missing" | "waiting" | "accepted" | "refused" | "expiring";

export interface DocumentCardModel {
  readonly docType: ApiDriverDocumentType;
  readonly labelKey: string;
  readonly tone: DocumentTone;
  readonly statusKey: string;
  readonly expiresAt: string | null;
  readonly daysLeft: number | null;
  readonly reviewNote: string | null;
  /** هل يُعرَضُ لها مُدخَلُ رفعٍ الآنَ — مقبولةٌ غيرُ منتهيةٍ لا تُرفَعُ ثانيةً بلا سببٍ. */
  readonly canUpload: boolean;
  readonly replaces: boolean;
}

function toneOf(row: ApiDriverDocumentRow): DocumentTone {
  if (!row.submitted || row.status === null) return "missing";
  if (row.status === "rejected" || row.status === "incomplete") return "refused";
  if (row.status === "accepted") return row.expires_soon ? "expiring" : "accepted";
  return "waiting";
}

function statusKeyOf(status: ApiDriverDocumentStatus | null): string {
  return status === null ? "driver.documents.status.missing" : `driver.documents.status.${status}`;
}

export function toDocumentCard(row: ApiDriverDocumentRow): DocumentCardModel {
  const tone = toneOf(row);
  return {
    docType: row.doc_type,
    labelKey: `driver.documents.type.${row.doc_type}`,
    tone,
    statusKey: statusKeyOf(row.status),
    expiresAt: row.expires_at,
    daysLeft: row.days_left,
    reviewNote: row.review_note,
    // مقبولةٌ ولا تقتربُ من الانتهاءِ: **لا زرَّ رفعٍ** — زرٌّ بلا حاجةٍ بابُ
    // إحلالٍ خاطئٍ يُعيدُ الوثيقةَ إلى `received` فيُبتلَعُ قبولٌ قائمٌ.
    canUpload: tone !== "accepted",
    replaces: row.submitted,
  };
}

/**
 * أسبابُ الحجبِ سطورَ فعلٍ. والسببُ الذي لا نوعَ له في القائمةِ **يُقالُ عامّاً**:
 * خادمٌ أحدثُ من الشاشةِ يُضيفُ نوعاً، والشاشةُ لا تسكتُ عن حجبٍ قائمٍ.
 *
 * وكلُّ سطرٍ **يسمّي الوثيقةَ**: «وثيقةٌ منتهيةٌ» مرّتَينِ بلا اسمٍ تجعلُ
 * السائقَ يحزرُ أيَّ ورقةٍ يحملُ — ومفتاحُ المُعرِّفِ يجعلُ السطرَ واحداً لا
 * يُخلَطُ بغيرِه في قائمةِ العرضِ.
 */
export interface BlockLine {
  readonly id: string;
  readonly messageKey: string;
  /** `null` = سببٌ لا يُعرَفُ نوعُ وثيقتِه في هذه النسخةِ. */
  readonly labelKey: string | null;
}

export function toBlockLines(
  reasons: readonly ApiDriverBlockReason[],
  unreadable: number,
): readonly BlockLine[] {
  const lines: BlockLine[] = [];
  for (const reason of reasons) {
    const known = DRIVER_DOCUMENT_TYPES.includes(reason.doc_type);
    lines.push({
      id: `${reason.code}:${reason.doc_type}`,
      messageKey: known
        ? `driver.documents.block.${reason.code}`
        : "driver.documents.block.UNKNOWN",
      labelKey: known ? `driver.documents.type.${reason.doc_type}` : null,
    });
  }
  if (unreadable > 0) {
    lines.push({
      id: `UNREADABLE:${unreadable}`,
      messageKey: "driver.documents.block.UNKNOWN",
      labelKey: null,
    });
  }
  return lines;
}

/**
 * هل يُعرَضُ زرُّ «أرسِلْ للمراجعةِ» — لا يُعرَضُ إن لم يُرفَعْ شيءٌ بعدُ: زرٌّ
 * يُردُّ `DOCUMENTS_INCOMPLETE` دائماً يُعلِّمُ السائقَ أنَّ الشاشةَ معطوبةٌ.
 */
export function canSubmitForReview(documents: readonly ApiDriverDocumentRow[]): boolean {
  return documents.some((row) => row.submitted && row.status === "received");
}

export interface LocalFileRejection {
  readonly key: string;
  readonly maxBytes?: number;
}

/**
 * فحصُ المِلفِّ قبلَ إنفاقِ بياناتِ السائقِ — و**حدُّه من الخادمِ**: `maxBytes`
 * و`allowed` يُقرآنِ من ردٍّ سابقٍ، وعندَ غيابِهما لا يُمنَعُ شيءٌ ههنا
 * (القاعدةُ تحكمُ) — **ولا يُخترَعُ حدٌّ في العميلِ**.
 */
export function rejectFileLocally(input: {
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly maxBytes: number | null;
  readonly allowedContentTypes: readonly string[] | null;
}): LocalFileRejection | null {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { key: "driver.documents.error.SIZE_INVALID" };
  }
  if (input.maxBytes !== null && input.sizeBytes > input.maxBytes) {
    return { key: "driver.documents.error.FILE_TOO_LARGE", maxBytes: input.maxBytes };
  }
  if (
    input.allowedContentTypes !== null &&
    !input.allowedContentTypes.includes(input.contentType)
  ) {
    return { key: "driver.documents.error.CONTENT_TYPE_NOT_ALLOWED" };
  }
  return null;
}

/**
 * فحصُ تاريخِ الانتهاءِ المكتوبِ — **باليومِ المدنيِّ لا بالطابعِ الزمنيِّ**:
 * `new Date("2026-09-15")` منتصفُ ليلِ UTC، ومقارنتُه بـ«الآنَ» في +03 تُسقِطُ
 * يومَ اليومِ خطأً. فالمقارنةُ نصٌّ بنصٍّ بعدَ التطبيعِ.
 */
export function rejectExpiryLocally(input: {
  readonly value: string;
  readonly todayPlainDay: string;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return "driver.documents.error.EXPIRY_INVALID";
  const parsed = Date.parse(`${input.value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "driver.documents.error.EXPIRY_INVALID";
  // **الشكلُ الصحيحُ لا يعني يوماً موجوداً**: `Date.parse("2027-02-31")` لا يُعطي
  // `NaN` في كلِّ مُحرِّكٍ، بل يُزلَقُ إلى الأوّلِ من آذارَ في بعضِها — فيُرسَلُ
  // إلى القاعدةِ يومٌ غيرُ الذي كتبَه السائقُ، أو يُرَدُّ عطبُ نوعٍ خامٌّ من
  // `date`. فالتصديقُ **رجوعٌ إلى النصِّ**: ما لا يُكتَبُ كما قُرِئَ ليسَ يوماً.
  if (new Date(parsed).toISOString().slice(0, 10) !== input.value) {
    return "driver.documents.error.EXPIRY_INVALID";
  }
  if (input.value <= input.todayPlainDay) return "driver.documents.error.EXPIRY_IN_PAST";
  const today = Date.parse(`${input.todayPlainDay}T00:00:00Z`);
  const days = Math.round((parsed - today) / 86_400_000);
  if (days > MAX_EXPIRY_DAYS_AHEAD) return "driver.documents.error.EXPIRY_TOO_FAR";
  return null;
}

/** «الآنَ» يوماً مدنيّاً بساعةِ الجهازِ — تُستعمَلُ للفحصِ اللطيفِ وحدَه. */
export function todayPlainDay(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** ملخَّصُ اللوحِ — سطرٌ واحدٌ يُقرأُ أوّلاً: أعملُ أم محجوبٌ ولِمَ. */
export interface BoardSummary {
  readonly headlineKey: string;
  readonly blockLines: readonly BlockLine[];
  readonly cards: readonly DocumentCardModel[];
  readonly canSubmit: boolean;
}

export function toBoardSummary(response: DriverDocumentsResponse): BoardSummary {
  const cards = response.documents.map(toDocumentCard);
  const headlineKey = response.is_blocked
    ? "driver.documents.headline.blocked"
    : cards.some((card) => card.tone === "expiring")
      ? "driver.documents.headline.expiring"
      : "driver.documents.headline.clear";
  return {
    headlineKey,
    blockLines: toBlockLines(response.block_reasons, response.unreadable_block_reasons),
    cards,
    canSubmit: canSubmitForReview(response.documents),
  };
}
