/**
 * الغرض: أنواعُ كشفِ الخصومِ التفصيليِّ للسائقِ (`DEC-37`) — قراءةٌ فقط من
 *   سجلِّ المحفظةِ. الاعتراضُ بلاغٌ يراجعه إنسانٌ، لا قيدٌ يُعكسُ تلقائياً.
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: packages/application/financial
 * الحاكم: `ADR 0161` — سطحُ المالِ للسائقِ.
 */

/** خصمٌ واحدٌ من سجلِّ المحفظةِ — مُدخَلٌ باتّجاهِ `debit`. */
export interface DeductionEntry {
  readonly id: string;
  readonly reference: string | null;
  readonly entryKind: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

/** صفحةٌ من كشفِ الخصومِ بترقيمِ مفتاحٍ. */
export interface DeductionTracePage {
  readonly deductions: readonly DeductionEntry[];
  readonly hasMore: boolean;
  readonly nextCursor: { readonly createdAt: string; readonly id: string } | null;
}

/** رموزُ الأخطاءِ العلنيّةِ — **شاملةٌ حرفاً**. */
export type DeductionTracePublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "SESSION_INVALID"
  | "SESSION_NOT_AVAILABLE"
  | "FINANCE_STORE_NOT_AVAILABLE"
  | "LIMIT_OUT_OF_RANGE"
  | "CURSOR_INVALID"
  | "NOT_A_DRIVER";
