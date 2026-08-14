/**
 * الغرض: شوطُ تسليم إشعارات دورة حياة الاشتراك لمدينةٍ واحدة، وصياغةُ نصّ كلّ
 *   إشعار بلغة صاحبه. الصياغة هنا لا في القاعدة: القاعدةُ تحفظ الواقعة، والنصّ
 *   يتغيّر مع اللغة والصياغة بلا هجرة.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/application/subscription
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/deliver-subscription-notices.ts
 * ملاحظات مستقبلية: أيُّ نوعٍ جديد يُضاف إلى `noticeText` — التبويم الكامل يجعل
 *   إغفالَه خطأَ ترجمةٍ لا إشعاراً صامتاً.
 */
import { t } from "../../shared/i18n/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type {
  SubscriptionNotice,
  SubscriptionNoticeDeliveryPort,
  SubscriptionNoticePublisher,
} from "./notice-ports.ts";

export interface DeliverNoticesDeps {
  readonly notices: SubscriptionNoticeDeliveryPort;
  readonly publisher: SubscriptionNoticePublisher;
}

export interface DeliverNoticesOutcome {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly retried: number;
}

/** تاريخٌ للعرض: يومٌ فقط. ساعةُ الانتهاء لا تعني السائق ولا يقرؤها. */
function dayOf(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/**
 * اسم الخطّة بلغة السائق. تمريرُ `transport` كما هي داخل رسالةٍ عربية يجعل
 * الرسالة تبدو نصفَ مترجمة، وهي أوّل ما يقرؤه السائق عن اشتراكه المدفوع.
 */
function planLabel(plan: string | undefined, language: string): string {
  const tr = t(language);
  if (plan === "transport") return tr("driver.service_transport");
  if (plan === "delivery") return tr("driver.service_delivery");
  if (plan === "both") return tr("driver.plan_both");
  return plan ?? "";
}

/**
 * نصّ الإشعار. الفروق بين الأنواع ليست تجميلاً:
 * • انتهاءُ التجربة دعوةٌ إلى الاشتراك أوّل مرّة، ومعها البابُ الثاني (قروب غير
 *   المشتركين) لأنّ من لا يقدر على الاشتراك اليوم يجب أن يبقى في المنصّة لا أن
 *   يخرج منها صامتاً.
 * • انتهاءُ اشتراكٍ مدفوع دعوةٌ إلى تجديدٍ يعرفه السائق أصلاً.
 * • الإلغاءُ نهايةٌ طلبها هو، فالتذكيرُ بأنّها بطلبه يمنع شكواه من قطعٍ لم يقع.
 */
export function noticeText(notice: SubscriptionNotice): string {
  const tr = t(notice.languageCode);
  const plan = planLabel(notice.payload.plan, notice.languageCode);
  const groupLink = notice.payload.group_link ?? "";
  const nextStep =
    groupLink === ""
      ? tr("driver.notice_group_ask_support")
      : tr("driver.notice_group_link", { link: groupLink });

  switch (notice.kind) {
    case "activated":
      return tr("driver.notice_activated", {
        plan,
        price: String(notice.payload.price ?? ""),
        currency: notice.payload.currency ?? "",
        until: dayOf(notice.payload.period_end),
      });
    case "trial_expired":
      return `${tr("driver.notice_trial_expired", { date: dayOf(notice.payload.ends_at) })}\n\n${nextStep}`;
    case "expired":
      return `${tr("driver.notice_expired", { plan, date: dayOf(notice.payload.ends_at) })}\n\n${nextStep}`;
    case "cancelled":
      return `${tr("driver.notice_cancelled", { plan, date: dayOf(notice.payload.ends_at) })}\n\n${nextStep}`;
  }
}

/**
 * الترتيب: أرسل ثمّ أعلن. وفشلُ الإعلان وحده يُسقط الشوط — الصفُّ حينها عالقٌ في
 * `sending` بلا موعد، والمضيُّ فوقه يعني إشعاراً يُرسَل مرّتين على سائقٍ واحد.
 */
export async function deliverSubscriptionNotices(
  cityId: string,
  deps: DeliverNoticesDeps,
): Promise<Result<DeliverNoticesOutcome, PortFailureError>> {
  const claimed = await deps.notices.claim(cityId);
  if (!claimed.ok) return claimed;

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const notice of claimed.value) {
    const published = await deps.publisher.publish({
      chatId: notice.chatId,
      text: noticeText(notice),
    });
    const finished = await deps.notices.finish({
      noticeId: notice.noticeId,
      claimToken: notice.claimToken,
      messageId: published.ok ? published.value.messageId : null,
      delivered: published.ok,
      permanent: published.ok ? false : published.error.permanent,
      errorCode: published.ok ? null : published.error.code,
    });
    if (!finished.ok) return finished;
    if (published.ok) sent += 1;
    else if (published.error.permanent || notice.attempts >= notice.maxAttempts) failed += 1;
    else retried += 1;
  }

  return ok({ claimed: claimed.value.length, sent, failed, retried });
}
