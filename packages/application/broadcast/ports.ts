/**
 * الغرض: منافذ البثّ الجماعي. الدوالّ الذرّية في القاعدة هي مصدر الحقيقة: هذه
 *   الطبقة لا تختار جمهوراً ولا تحسب عدداً ولا تقفل صفّاً بنفسها.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/application/broadcast
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/broadcast،
 *   apps/workers/src/jobs/deliver-broadcasts.ts، apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: عند إضافة قناةٍ غير تلغرام يُنفَّذ `BroadcastPublisher` مجاوراً.
 */
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type BroadcastAudience = "drivers" | "riders";

/** مرشّحات الجمهور كما تُسلَّم إلى القاعدة — تُحفَظ مع الحملة كما هي. */
export interface BroadcastFilters {
  readonly languages?: readonly string[];
  readonly verification?: readonly string[];
  readonly subscription?: readonly string[];
  readonly availability?: "any" | "available" | "unavailable";
  readonly activity?: "any" | "ordered_recently" | "never_ordered";
}

export interface BroadcastCityCount {
  readonly cityId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly recipients: number;
}

export interface BroadcastPlan {
  readonly cities: readonly BroadcastCityCount[];
  readonly total: number;
}

export interface CreateBroadcastInput {
  readonly actorUserId: string;
  /** `null` تعني كلّ المدن: صفُّ حملةٍ لكلّ مدينة بمعرّف دفعةٍ واحد. */
  readonly cityId: string | null;
  readonly audience: BroadcastAudience;
  readonly filters: BroadcastFilters;
  readonly body: string;
  readonly linkLabel: string | null;
  readonly linkUrl: string | null;
  readonly silent: boolean;
  readonly sendAfter: Date | null;
}

export interface CreatedBroadcast {
  readonly batchId: string;
  readonly total: number;
  readonly cities: readonly { readonly cityId: string; readonly recipients: number }[];
}

/** منفذ الإدارة: العدّ والإنشاء والإلغاء. الصلاحية تُتحقَّق داخل القاعدة. */
export interface BroadcastAdminPort {
  count(input: {
    actorUserId: string;
    cityId: string | null;
    audience: BroadcastAudience;
    filters: BroadcastFilters;
  }): Promise<Result<BroadcastPlan | { error: string }, PortFailureError>>;
  create(
    input: CreateBroadcastInput,
  ): Promise<Result<CreatedBroadcast | { error: string }, PortFailureError>>;
  cancel(input: {
    actorUserId: string;
    batchId: string;
  }): Promise<Result<{ canceled: number } | { error: string }, PortFailureError>>;
}

/** صفٌّ محجوزٌ للإرسال الآن، بكلّ ما يحتاجه الناشر بلا استعلامٍ ثانٍ. */
export interface BroadcastRecipient {
  readonly recipientId: string;
  /** جمهورُ الحملة: يحدّد بأيّ بوتٍ تُرسَل الرسالة، فيُقرأ مع الصفّ لا باستعلامٍ ثانٍ. */
  readonly audience: BroadcastAudience;
  readonly claimToken: string;
  readonly chatId: string;
  readonly languageCode: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly body: string;
  readonly silent: boolean;
  readonly linkLabel: string | null;
  readonly linkUrl: string | null;
}

export interface BroadcastDeliveryPort {
  claim(cityId: string): Promise<Result<readonly BroadcastRecipient[], PortFailureError>>;
  finish(input: {
    recipientId: string;
    claimToken: string;
    messageId: string | null;
    delivered: boolean;
    /**
     * فشلٌ لا تُغيّره إعادةُ المحاولة: من حجب البوت لن يستقبلها بعد أربع محاولات،
     * وإعادتُها تحرق حدَّ تلغرام على من لن يصله شيء.
     */
    permanent: boolean;
    errorCode: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
}

/** سببُ إخفاق نشرةٍ واحدة، ومعه حكمُ الدوام: عليه تُبنى إعادةُ المحاولة. */
export interface BroadcastSendFailure {
  readonly code: string;
  readonly permanent: boolean;
}

export interface BroadcastPublisher {
  publish(
    recipient: BroadcastRecipient,
  ): Promise<Result<{ messageId: string }, BroadcastSendFailure>>;
}
