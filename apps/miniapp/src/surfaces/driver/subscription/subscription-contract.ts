/**
 * الغرض: شكلُ ردَّي اشتراكِ السائقِ كما يقرؤهما العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `subscription-api.ts` · `subscription-view.ts` · `SubscriptionScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدُ الاشتراكِ عقدٌ يُضافُ، ولا يُوسَّعُ
 *   هذا العقدُ ليحملَ رابطَ دفعٍ.
 * يحرسُه: scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ الأسعارُ في عقدِ القراءةِ لا في ثابتِ شاشةٍ
 *
 * لأنَّ الشاشةَ تنسخُ السعرَ إن لم يصلها، والنسخةُ تتخلَّفُ. فالسعرُ يصلُها من
 * الخادمِ في هذا العقدِ، والخادمُ يقرأُه من `platform_settings` — فمصدرُ
 * الحقيقةِ واحدٌ للعرضِ وللتفعيلِ.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا هويّةَ راكبٍ**: لا اسمَ ولا هاتفَ ولا معرِّفاً.
 *   ــ **لا مقارنةً بسائقٍ آخرَ**: لا رُتبةَ ولا متوسّطَ.
 */

/** أسعارُ الخططِ الثلاثُ — كلُّ رقمٍ من `platform_settings`. */
export interface ApiSubscriptionPlanPrices {
  readonly transport: number;
  readonly delivery: number;
  readonly both: number;
}

export interface ApiDriverSubscriptionDashboardResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly has_subscription: boolean;
  readonly plan_prices: ApiSubscriptionPlanPrices;
  readonly currency: string;
  readonly trial_days: number;
  readonly period_days: number;
  readonly subscription_id: string | null;
  readonly plan: "transport" | "delivery" | "both" | null;
  readonly status: "trialing" | "active" | "expired" | "cancelled" | null;
  readonly is_trial: boolean | null;
  readonly price: number | null;
  readonly trial_ends_at: string | null;
  readonly current_period_end: string | null;
  readonly ends_at: string | null;
  readonly days_left: number | null;
  readonly expires_soon: boolean | null;
  readonly cancel_at_period_end: boolean | null;
  readonly cancellation_requested_at: string | null;
  readonly warning_days: number | null;
}

export interface ApiSubscriptionPaymentEntry {
  readonly transaction_id: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly provider: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string | null;
  readonly plan: string | null;
  readonly checkout_url: string | null;
}

export interface ApiDriverSubscriptionHistoryResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly limit: number;
  readonly entries: readonly ApiSubscriptionPaymentEntry[];
}

export interface ApiDriverSubscriptionRenewalResponse {
  readonly ok: true;
  readonly transaction_id: string;
  readonly checkout_url: string | null;
  readonly status: string;
  readonly plan: "transport" | "delivery" | "both";
  readonly amount_minor: number;
  readonly currency: string;
}
