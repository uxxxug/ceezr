/**
 * الغرض: منافذ صندوق إشعارات دورة حياة الاشتراك. الصفّ يُكتب في القاعدة داخل
 *   معاملة تغيُّر الحالة، وهذه الطبقة تسلّمه فقط: لا تقرّر من يستحقّ إشعاراً.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/application/subscription
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/subscription/notice-adapters.ts،
 *   apps/workers/src/jobs/deliver-subscription-notices.ts
 * ملاحظات مستقبلية: نوعٌ جديد يُضاف إلى `SubscriptionNoticeKind` وإلى جدول النصوص
 *   في `deliver-notices.ts` معاً — إغفال الثاني يُنتج إشعاراً بلا نصّ.
 */
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** يقابل `subscription_notice_kind` في القاعدة حرفاً بحرف. */
export type SubscriptionNoticeKind = "activated" | "trial_expired" | "expired" | "cancelled";

/** حمولة الإشعار كما كتبتها القاعدة — كلّ الحقول اختيارية دفاعياً لا تفاؤلاً. */
export interface SubscriptionNoticePayload {
  readonly plan?: string;
  readonly period_end?: string;
  readonly ends_at?: string;
  readonly price?: number | string;
  readonly currency?: string;
  /** رابط قروب غير المشتركين، أو نصّ فارغ إن لم يضعه المالك بعد. */
  readonly group_link?: string;
}

export interface SubscriptionNotice {
  readonly noticeId: string;
  readonly kind: SubscriptionNoticeKind;
  readonly claimToken: string;
  readonly chatId: string;
  readonly languageCode: string;
  readonly payload: SubscriptionNoticePayload;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface SubscriptionNoticeFailure {
  readonly code: string;
  readonly permanent: boolean;
}

export interface SubscriptionNoticePublisher {
  publish(input: {
    readonly chatId: string;
    readonly text: string;
  }): Promise<Result<{ messageId: string }, SubscriptionNoticeFailure>>;
}

export interface SubscriptionNoticeDeliveryPort {
  claim(cityId: string): Promise<Result<readonly SubscriptionNotice[], PortFailureError>>;
  finish(input: {
    readonly noticeId: string;
    readonly claimToken: string;
    readonly messageId: string | null;
    readonly delivered: boolean;
    readonly permanent: boolean;
    readonly errorCode: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
}
