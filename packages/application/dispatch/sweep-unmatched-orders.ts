/**
 * الغرض: التقاط الطلبات التي بقيت في حالة البحث بلا عرضٍ حيّ، فتُصعَّد إلى قروب
 *   الإسناد ويُخبَر صاحبها بالحقيقة. قبل هذه الحالة كان الطلب الذي لا يجد
 *   مرشَّحاً يسقط في فراغ: لا عرض يُكتب فلا شيء تُنهي مهلته expire-offers،
 *   ولا دورة تفاوض تُنشأ فلا شيء تُدوّره rotate-negotiations. فيبقى الطلب
 *   'searching' إلى الأبد، والراكب ينتظر بلا كلمة حتى يلغي بنفسه.
 *
 *   وطبقةٌ ثانيةٌ من اليتم كُشفت لاحقاً وأُغلقت: الاستعلام كان يشترط «بلا أي عرض»،
 *   فطلبٌ عُرِض فتجاهله السائق حتّى استنفدت دوراتُه يخرج من المسارين معاً: redispatch
 *   تردّه بـBROADCAST_ROUNDS_EXHAUSTED وتقول «مسارُه التصعيد لا البثّ»، والتصعيد
 *   لا يراه لأنّ له عرضاً. فيبقى 'searching' إلى الأبد وقد قيل للراكب «سيصلك ردٌّ
 *   قريباً». وقُيس ذلك على قاعدةٍ حقيقية: طلبٌ بدورة ٣ من ٣ وعرضٍ منتهٍ وانتظارِ
 *   عشرِ دقائق رآه الاستعلام صفراً، ولولا ذاك الشرط رآه واحداً.
 * الحالة: منفّذ ومُختبَر على قاعدة حقيقية.
 * ينتمي إلى: packages/application/dispatch
 * يستخدمه: apps/workers/src/jobs/sweep-unmatched-orders.ts
 * ملاحظات مستقبلية: تعدّد النسخ آمن — عدم تكرار التصعيد مضمون في القاعدة
 *   عبر escalate_order (فحص audit_log داخل صفّ مقفول)، لا في ذاكرة العملية.
 */

import { roundsExhausted } from "../../domain/transport/entity.ts";
import type { CityId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import {
  type EscalateUnmatchedOrderDependencies,
  escalateUnmatchedOrder,
} from "./escalate-unmatched-order.ts";

/** طلب عالق: يبحث منذ مدة، وليس له عرضٌ حيّ ولا سائق مُسنَد. */
export interface UnmatchedOrder {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  /** معرّف محادثة الراكب في تيليجرام — يُراسَل ببوت الراكب لا ببوت السائق. */
  readonly riderChatId: string;
  readonly riderLanguage: string | null;
  /** رقم دورة البثّ كما هو في القاعدة — مادةٌ للحكم لا زينةً للسجلّ. */
  readonly broadcastRound: number;
  /**
   * أله عرضٌ واحدٌ قطّ؟ حالةٌ تُقرأ لا حكمٌ يُفتى: من لم يُعرض له قطّ يُصعَّد ولو
   * بقيت دوراتُه، لأنّ علّته انعدام المرشّحين لا تجاهلُ سائق. ومنها يُبنى السبب
   * المعروض على الموظّف: «لا سائق أبداً» غير «تجاهلوا حتّى نفدت الدورات».
   */
  readonly hasAnyOffer: boolean;
  readonly waitingSeconds: number;
}

export interface UnmatchedOrderFinder {
  /**
   * الطلبات الباحثة منذ أكثر من العتبة بلا عرضٍ حيّ (pending ولمّا تنتهِ مهلتُه).
   * ومن لمّا يزل في مسار دورات البثّ يُستبعد في `sweepUnmatchedOrders` بحكم المجال
   * لا بشرط SQL: حدّ الدورات من إعدادات المدينة، واستعلامٌ يفتي يصير موضعاً
   * ثانياً للقاعدة ينزلق وحده يوم تتغير القاعدة.
   */
  findStaleSearching(
    cityId: CityId,
    olderThanSeconds: number,
  ): Promise<Result<readonly UnmatchedOrder[], PortFailureError>>;
}

export interface UnmatchedRiderNotifier {
  /** يُستدعى مرّة واحدة لكل طلب: عند أوّل تصعيد فعلي لا في كل شوط. */
  noDriverFound(order: UnmatchedOrder): Promise<Result<void, PortFailureError>>;
}

export interface SweepUnmatchedDependencies {
  readonly finder: UnmatchedOrderFinder;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly notifier: UnmatchedRiderNotifier;
  /** عتبة الانتظار قبل التصعيد — تأتي من إعدادات المدينة لا من ثابت في الكود. */
  readonly staleAfterSeconds: number;
  /**
   * حدّ دورات البثّ — platform_settings.max_broadcast_rounds للمدينة نفسها التي يقرأها
   * البثّ. لو قرأ المسح حدّاً أعلى من حدّ البثّ لما صَعَّد أحداً وعاد اليتم بصمت.
   */
  readonly maxBroadcastRounds: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface SweepUnmatchedReport {
  readonly cityId: CityId;
  readonly examined: number;
  readonly escalated: readonly OrderId[];
  readonly notified: readonly OrderId[];
  /** طلبات كانت مُصعَّدة من قبل — تُعدّ ولا تُصعَّد ثانية ولا يُزعَج صاحبها. */
  readonly alreadyEscalated: number;
  /**
   * طلباتٌ عُرِضت ولمّا تستنفد دوراتها: تُترك للبثّ ولا تُصعَّد بعد. تُعدّ صراحةً
   * لأنّ «فحصتُ 5 وصعّدتُ 0» بلا بيان سببٍ من أخطر أنواع السجلّ: يبدو طمأنينةً.
   */
  readonly stillBroadcasting: number;
  readonly failed: number;
}

export async function sweepUnmatchedOrders(
  cityId: CityId,
  deps: SweepUnmatchedDependencies,
): Promise<Result<SweepUnmatchedReport, PortFailureError>> {
  const stale = await deps.finder.findStaleSearching(cityId, deps.staleAfterSeconds);
  if (!stale.ok) return stale;

  const escalated: OrderId[] = [];
  const notified: OrderId[] = [];
  let alreadyEscalated = 0;
  let stillBroadcasting = 0;
  let failed = 0;

  for (const order of stale.value) {
    /**
     * الحكم هنا لا في SQL. من عُرِض له ولمّا تنفد دوراتُه يُترك للبثّ: تصعيدُه
     * يسبق أوانه ويُغرق قروب الإسناد بحالات لم تستنفد طريقها الطبيعي. ومن لم يُعرض
     * له قطّ يُصعَّد فوراً ولو كانت دورتُه صفراً: لا مرشّح له في المدينة أصلاً،
     * وإمهالُه دوراتٍ لن تجد أحداً إطالةُ صمتٍ لا إنصاف.
     */
    const exhausted = roundsExhausted(order.broadcastRound, deps.maxBroadcastRounds);
    if (order.hasAnyOffer && !exhausted) {
      stillBroadcasting += 1;
      continue;
    }

    /**
     * السبب يقول الحقيقة لموظّف الإسناد: إنّ من عُرِض له فتجاهلوه حتّى نفدت
     * الدورات ليس «لا يوجد أي سائق متاح في المدينة» — والتصرّف يختلف باختلافهما.
     */
    const result = await escalateUnmatchedOrder(
      {
        orderId: order.orderId,
        reason: order.hasAnyOffer ? "broadcast_rounds_exhausted" : "no_driver_at_all",
        cyclesTried: order.broadcastRound,
      },
      deps.escalate,
    );

    if (!result.ok) {
      // طلب واحد معطوب لا يُسقط بقية طلبات المدينة: يُسجَّل ويُمضى.
      failed += 1;
      deps.log?.("sweep.escalation_failed", { orderId: order.orderId, cityId });
      continue;
    }

    if (!result.value.escalated) {
      alreadyEscalated += 1;
      continue;
    }

    escalated.push(order.orderId);

    /**
     * الإشعار معلَّق على escalated === true عمداً، ولا يحتاج عموداً جديداً:
     * تلك القيمة صارت تعني «وصلت بطاقة الإسناد الآن لأوّل مرّة»، وهي انتقالُ صفٍّ
     * مقفولٍ من غير مسلَّمٍ إلى مسلَّم داخل mark_escalation_delivered — فالمرّة الوحيدة
     * التي تصل هنا هي المرّة الأولى، و"رسالة واحدة للراكب" مضمونٌ في القاعدة لا
     * رجاءً في الذاكرة.
     *
     * ولا يُخبَر الراكب قبل أن يعلم موظّف الإسناد: كان الأثر يُكتب قبل الإرسال، فكان
     * إخفاقٌ عابرٌ يُنتج أثراً يقول «صُعِّد» وبطاقةً لم تصل وراكباً لم يُخبَر وحارساً
     * يمنع كلّ إعادة — طلبٌ يتيمٌ صامتٌ إلى الأبد. الآن يُعاد في الشوط التالي.
     */
    const told = await deps.notifier.noDriverFound(order);
    if (told.ok) {
      notified.push(order.orderId);
    } else {
      deps.log?.("sweep.rider_notify_failed", { orderId: order.orderId, cityId });
    }
  }

  return ok({
    cityId,
    examined: stale.value.length,
    escalated,
    notified,
    alreadyEscalated,
    stillBroadcasting,
    failed,
  });
}
