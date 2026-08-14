/**
 * الغرض: دورة حياة الاشتراك بمرور الوقت: إنهاء المستحقّ، وتحذير من يقترب انتهاؤه
 *   قبل يوم أو يومين. القرار هنا، والكتابة الذرّية في القاعدة عبر منافذ محقونة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: application/subscription
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/expire-subscriptions.ts، لوحة الإدارة
 * ملاحظات مستقبلية: التجديد المدفوع التلقائي يضيف منفذاً ثالثاً بلا تغيير هذين التوقيعين.
 */

import { t } from "../../shared/i18n/index.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface ExpireSubscriptionsOutcome {
  /** عدد الاشتراكات التي انتقلت فعلاً إلى expired. */
  readonly expiredCount: number;
}

/** اشتراك يقترب انتهاؤه، بكل ما يلزم لإرسال رسالة واحدة بلا استعلام إضافي. */
export interface ExpiringSubscription {
  readonly subscriptionId: string;
  readonly cityId: CityId;
  readonly driverId: DriverId;
  readonly telegramId: string;
  readonly languageCode: string;
  readonly plan: string;
  readonly status: string;
  readonly endsAt: Date;
  readonly daysLeft: number;
}

/** يقابل الدالّات expire_due_subscriptions و subscriptions_expiring_soon و record_subscription_warning. */
export interface SubscriptionLifecycleRpcPort {
  expireDue(): Promise<Result<ExpireSubscriptionsOutcome, PortFailureError>>;
  /**
   * مُفتاحٌ بالمدينة لا عابرٌ للمدن: المهمّةُ التي تُناديه مسجَّلةٌ لكلّ مدينة،
   * ومهامُّ المدن تُطلق في نفس النبضة بأقفالٍ مختلفة. فقائمةٌ عابرةٌ تعني أنّ
   * السائقَ الواحد يستقبل تحذيراً بعددِ المدن النشطة.
   */
  expiringSoon(input: {
    readonly cityId: CityId;
    readonly days: number;
  }): Promise<Result<readonly ExpiringSubscription[], PortFailureError>>;
  /**
   * لا يستقبل تاريخ الانتهاء: القاعدة تقرأه من الصفّ نفسه. تمريره من هنا كان يعني
   * إعادة قيمة اقتطعتها JavaScript إلى المللي ثانية، فلا تُطابق الأصل ويتكرّر التحذير.
   */
  recordWarning(subscriptionId: string): Promise<Result<void, PortFailureError>>;
}

/**
 * منفذ الإرسال. يعيد نجاحاً أو فشلاً لأن التثبيت في القاعدة معلَّق عليه:
 * لا نُثبِّت «حُذِّر» إلّا بعد أن تخرج الرسالة فعلاً.
 */
export interface ExpiryWarningSender {
  send(input: {
    readonly chatId: string;
    readonly text: string;
  }): Promise<Result<void, PortFailureError>>;
}

export async function expireDueSubscriptions(deps: {
  readonly rpc: SubscriptionLifecycleRpcPort;
}): Promise<Result<ExpireSubscriptionsOutcome, PortFailureError>> {
  return deps.rpc.expireDue();
}

export interface WarnExpiringReport {
  readonly examined: number;
  readonly warned: number;
  /** من فشل إرسالها: لم تُثبَّت في القاعدة، فستُحاوَل في الشوط القادم. */
  readonly failed: readonly string[];
}

export interface WarnExpiringDependencies {
  readonly rpc: SubscriptionLifecycleRpcPort;
  readonly sender: ExpiryWarningSender;
  /** يُستدعى عند فشل إرسال واحد — الفشل لا يُوقف بقية الدفعة لكنه لا يُخفى. */
  readonly onSendFailure?: (subscriptionId: string, failure: PortFailureError) => void;
}

/**
 * تحذير مسبَق قبل انتهاء الاشتراك. ترتيب الخطوتين مقصود ولا يجوز عكسه:
 * الإرسال أولاً، ثم التثبيت. لو ثبّتنا قبل الإرسال ثم سقطت شبكة تيليجرام،
 * حُرم السائق تحذيره إلى الأبد وفوجئ بانقطاع رزقه. أمّا العكس — تحذير مكرَّر
 * حين ينجح الإرسال ويفشل التثبيت — فإزعاجٌ يُحتمَل.
 *
 * فشل سائق واحد لا يُوقف الدفعة: من ينتهي اشتراكه غداً لا يُحرَم تحذيره لأن
 * سائقاً قبله في القائمة حجب البوت.
 */
export async function warnExpiringSubscriptions(
  input: { readonly cityId: CityId; readonly days: number },
  deps: WarnExpiringDependencies,
): Promise<Result<WarnExpiringReport, PortFailureError>> {
  const due = await deps.rpc.expiringSoon({ cityId: input.cityId, days: input.days });
  if (!due.ok) return due;

  const failed: string[] = [];
  let warned = 0;

  for (const subscription of due.value) {
    const tr = t(subscription.languageCode);
    const date = subscription.endsAt.toISOString().slice(0, 10);
    // «ينتهي بعد يوم واحد» صياغة باردة أمام «ينتهي غداً». الفرق ليس تجميلاً:
    // الرسالة التي يفهمها السائق فوراً هي التي يتحرّك بها قبل أن ينقطع دخله.
    const text =
      subscription.daysLeft <= 1
        ? tr("subscription.expiring_tomorrow", { date })
        : tr("subscription.expiring_soon", { days: subscription.daysLeft, date });

    const sent = await deps.sender.send({ chatId: subscription.telegramId, text });
    if (!sent.ok) {
      failed.push(subscription.subscriptionId);
      deps.onSendFailure?.(subscription.subscriptionId, sent.error);
      continue;
    }

    const recorded = await deps.rpc.recordWarning(subscription.subscriptionId);
    if (!recorded.ok) {
      // الرسالة وصلت والتثبيت فشل: يُحسب محذَّراً لأنه محذَّر فعلاً، ويُسجَّل
      // الفشل ليُعرف سبب التكرار المحتمل في الشوط القادم.
      deps.onSendFailure?.(subscription.subscriptionId, recorded.error);
    }
    warned += 1;
  }

  return ok({ examined: due.value.length, warned, failed });
}
