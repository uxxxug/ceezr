/**
 * الغرض: مجالُ وثائقِ السائقِ — **أنواعُ الوثائقِ** و**مراحلُ التحقُّقِ**
 *   و**قراءةُ أسبابِ الحجبِ**، معرَّفةً مرّةً واحدةً (`F3-01` · `SD-01` ·
 *   `SD-02` · `F12-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/*` · `packages/infrastructure/driver/*`
 *   · `apps/gateway/src/routes/driver-documents.ts`
 *   · `apps/miniapp/src/surfaces/driver/documents/*`
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` (مركبتي) — رخصةُ السيرِ والتأمينُ
 *   والفحصُ الدوريُّ تُقرأُ من ههنا، ولا تُنسَخُ قائمةٌ ثانيةٌ في سطحِ المركبةِ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لماذا سببُ الحجبِ **نصٌّ مُركَّبٌ** `CODE:doc_type` ولا رسالةٌ جاهزةٌ
 *
 * القاعدةُ لا تعرفُ لغةَ السائقِ ولا نصَّ شاشتِه، ورسالةٌ مكتوبةٌ فيها تُقفِلُ
 * الترجمةَ في مكانٍ لا قاموسَ فيه. **والشطرانِ يُقرآنِ**: رمزٌ مغلقُ المجالِ
 * ونوعُ وثيقةٍ مغلقُ المجالِ — فتبني الشاشةُ «رخصةُ قيادتِكَ منتهيةٌ» بلغتِه
 * من مفتاحَينِ، وسببٌ لا يُقرأُ **يُعرَضُ عاماً ولا يُخفى**.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ ما الوثائقُ الإلزاميّةُ**: القائمةُ إعدادُ مدينةٍ
 *      (`driver_required_document_types`) لا ثابتٌ في شِفرةٍ — ولائحةُ الهيئةِ
 *      تتغيَّرُ ولا يُعاد نشرُ التطبيقِ لأجلِها. وما ههنا **مجالُ ما يُمكِنُ**
 *      لا **مجالُ ما يُفرَضُ**.
 *   ــ **لا يحسبُ انتهاءً**: `expires_at < today` حكمُ القاعدةِ بساعتِها،
 *      وحسابُه من ساعةِ المتصفِّحِ يجعلُ حجباً يختلفُ باختلافِ هاتفٍ.
 *   ــ **لا يُوقِّعُ رابطاً ولا يعرفُ مخزناً**: التوقيعُ في المِعمارِ الخارجيِّ.
 */

/**
 * أنواعُ الوثائقِ — **مجالٌ مغلقٌ يُقابِلُ `driver_document_type` حرفاً**، وهيَ
 * الستُّ المنصوصةُ في لائحةِ نشاطِ التوجيهِ (القسم 16.1).
 */
export const DRIVER_DOCUMENT_TYPES = [
  /** رخصةُ القيادةِ. */
  "driving_license",
  /** الفحصُ الطبيُّ المُحدَّدُ من الهيئةِ. */
  "medical_exam",
  /** شهادةُ خلوِّ السوابقِ — تُحدَّثُ سنويّاً. */
  "criminal_record",
  /** رخصةُ سيرِ المركبةِ. */
  "vehicle_registration",
  /** تأمينٌ يغطّي المسؤوليّةَ المدنيّةَ ويشملُ الركّابَ. */
  "insurance",
  /** الفحصُ الفنّيُّ الدوريُّ. */
  "periodic_inspection",
] as const;

export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export function isDriverDocumentType(value: unknown): value is DriverDocumentType {
  return typeof value === "string" && (DRIVER_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * مراحلُ التحقُّقِ — **نصُّ `SD-02` حرفاً**: مُستلَم / قيد المراجعة / ناقص /
 * مقبول / مرفوض. و«لم يُرسَلْ» **ليسَ مرحلةً** بل غيابُ صفٍّ، فلا تُخترَعُ له
 * قيمةٌ سادسةٌ لا تعرفُها القاعدةُ.
 */
export const DRIVER_DOCUMENT_STATUSES = [
  "received",
  "under_review",
  "incomplete",
  "accepted",
  "rejected",
] as const;

export type DriverDocumentStatus = (typeof DRIVER_DOCUMENT_STATUSES)[number];

export function isDriverDocumentStatus(value: unknown): value is DriverDocumentStatus {
  return (
    typeof value === "string" && (DRIVER_DOCUMENT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * رموزُ الحجبِ — **مجالٌ مغلقٌ** يُقابِلُ ما تبنيه
 * `driver_document_block_reasons` في القاعدةِ.
 */
export const DRIVER_BLOCK_CODES = [
  /** لا صفَّ للوثيقةِ الإلزاميّةِ أصلاً. */
  "MISSING",
  /** مرفوضةٌ — ومعَها سببٌ مكتوبٌ يُعرَضُ للسائقِ. */
  "REJECTED",
  /** مُستلَمةٌ أو قيدَ المراجعةِ أو ناقصةٌ — أي **لم تُقبَلْ بعدُ**. */
  "UNVERIFIED",
  /** مقبولةٌ ومضى تاريخُها — هذا ما يُحجَبُ بهِ آليّاً (`F12-14`). */
  "EXPIRED",
] as const;

export type DriverBlockCode = (typeof DRIVER_BLOCK_CODES)[number];

export interface DriverBlockReason {
  readonly code: DriverBlockCode;
  readonly docType: DriverDocumentType;
}

/**
 * قراءةُ سببٍ من نصِّه. و**سببٌ لا يُقرأُ يُردُّ `null`** ولا يُرمى ولا
 * يُصنَّفُ عطبَ مخزنٍ: الشاشةُ تعرضُ ما فهمَت وتعرضُ للباقي سطراً عامّاً
 * «راجِعْ الدعمَ» — فرمزٌ جديدٌ في القاعدةِ لا يُخفي حجباً قائماً.
 */
export function parseBlockReason(value: unknown): DriverBlockReason | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const code = value.slice(0, separator);
  const docType = value.slice(separator + 1);
  if (!(DRIVER_BLOCK_CODES as readonly string[]).includes(code)) return null;
  if (!isDriverDocumentType(docType)) return null;
  return { code: code as DriverBlockCode, docType };
}

/** صفُّ وثيقةٍ كما يُعرَضُ في `SD-02` — والغيابُ `status: null`. */
export interface DriverDocumentRow {
  readonly docType: DriverDocumentType;
  readonly submitted: boolean;
  readonly status: DriverDocumentStatus | null;
  /** تاريخٌ بصيغةِ `YYYY-MM-DD` — يومٌ لا لحظةٌ. */
  readonly expiresAt: string | null;
  readonly daysLeft: number | null;
  readonly expiresSoon: boolean;
  readonly reviewNote: string | null;
  readonly submittedAt: string | null;
  readonly reviewedAt: string | null;
}

/** لوحُ `SD-02` كامِلاً — ومعَه حكمُ الحجبِ **كما نطقَت بهِ القاعدةُ**. */
export interface DriverDocumentDashboard {
  readonly verificationStatus: string;
  readonly warningDays: number;
  readonly documents: readonly DriverDocumentRow[];
  readonly blockReasons: readonly DriverBlockReason[];
  /**
   * أسبابٌ نطقَت بها القاعدةُ ولم تُقرأْ ههنا — **تُنقَلُ ولا تُطرَحُ**:
   * عددٌ فوقَ الصفرِ يعني «محجوبٌ لسببٍ لا تعرفُه هذه النسخةُ»، وطرحُها
   * يجعلُ الشاشةَ تقولُ «كلُّ شيءٍ تمامٌ» لسائقٍ محجوبٍ.
   */
  readonly unreadableBlockReasons: number;
  readonly isBlocked: boolean;
}

/** خانةُ رفعٍ موقَّعةٌ — ما يحتاجُه العميلُ ليرفعَ **بلا مرورِ البايتِ بنا**. */
export interface DriverDocumentUploadSlot {
  readonly docType: DriverDocumentType;
  readonly objectPath: string;
  readonly uploadUrl: string;
  /**
   * رمزُ الرفعِ إن فصلَه المزوِّدُ عن الرابطِ. **يُعادُ كما هو ولا يُفكَّكُ**:
   * تفكيكُه ههنا يربطُنا بصيغةِ مزوِّدٍ بعينِه (`ADR 0115` §٤).
   */
  readonly uploadToken: string | null;
  readonly maxBytes: number;
  readonly expiresAtEpochMs: number;
}

/** الحدُّ الأدنى لعمرِ رابطِ الرفعِ: ثانيةٌ واحدةٌ لا تكفي لرفعٍ من هاتفٍ. */
export const MIN_UPLOAD_TTL_SECONDS = 30;

/** والأقصى: ساعةٌ. رابطٌ يعيشُ يوماً **مفتاحٌ منسوخٌ في محادثةٍ**. */
export const MAX_UPLOAD_TTL_SECONDS = 3600;

/**
 * أقصى مدىً مقبولٍ لتاريخِ انتهاءٍ — عشرونَ سنةً. والقاعدةُ تحرسُه أيضاً؛
 * وهذا الحاجزُ **يمنعُ ذهاباً إلى الشبكةِ** لخطأِ إدخالٍ ظاهرٍ.
 */
export const MAX_EXPIRY_DAYS_AHEAD = 7300;

/** صيغةُ يومٍ صِرفٍ — `YYYY-MM-DD` بلا وقتٍ ولا منطقةٍ. */
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * قراءةُ يومٍ صِرفٍ. **لا `new Date(text)` وحدَها**: تلكَ تقبلُ
 * `"2026-02-31"` وتُصحِّحُه صامتةً إلى مارسَ، فتُخزَّنُ رخصةٌ تنتهي في يومٍ
 * لم يُكتَبْ. فالمقابلةُ على الصيغةِ **ثمَّ** على مطابقةِ إعادةِ البناءِ.
 */
export function parsePlainDay(value: unknown): string | null {
  if (typeof value !== "string" || !PLAIN_DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}
