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
  type EscalationReason,
  escalateUnmatchedOrder,
} from "./escalate-unmatched-order.ts";
import {
  type PublishToUnsubscribedGroupDependencies,
  publishToUnsubscribedGroup,
} from "./publish-to-unsubscribed-group.ts";

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

export interface SweepUnmatchedDependencies {
  readonly finder: UnmatchedOrderFinder;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  /**
   * الباب الثاني (القسم ٣.٤): قروب السائقين غير المشتركين. تبعيّةٌ لازمةٌ لا
   * اختياريّة عن قصد — لأنّ إغفال توصيلها هو بعينه العطب الذي كان قائماً: كامل
   * آلة القروب مبنيّةٌ ومُختبَرة، ولا أحد يفتح دورتها الأولى، فتذهب كلّ طلبات
   * الإنتاج إلى قروب الإسناد بشراً يعالجونها بأيديهم، ويبقى قروب غير المشتركين
   * فارغاً — وهو نفسه قناةُ تحويل السائق المنتهي تجربتُه إلى مشترك.
   */
  readonly unsubscribed: PublishToUnsubscribedGroupDependencies;
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
  /**
   * طلباتٌ أُودِعَ إخطارُ «لا سائقَ» لأصحابها في معاملةِ التسليمِ نفسِها (BUG-004).
   * لا تعني «وصلت الرسالة»: الإرسالُ يقعُ بعدَ الالتزامِ ومن عاملِ الصادرِ، وهو
   * وحدَه ما جعلَ الإخطارَ يُعادُ حتّى يصلَ بدلَ أن يذهبَ مع أوّلِ تعطّلٍ في تيليجرام.
   */
  readonly queuedNoDriver: readonly OrderId[];
  /** طلبات كانت مُصعَّدة من قبل — تُعدّ ولا تُصعَّد ثانية ولا يُزعَج صاحبها. */
  readonly alreadyEscalated: number;
  /** طلباتٌ نُشرت بطاقتُها الآن في قروب غير المشتركين: الباب الثاني فُتح فعلاً. */
  readonly offeredToUnsubscribed: readonly OrderId[];
  /**
   * طلباتٌ أُودِعَ لأصحابها إخطارُ الانتقالِ إلى الدائرةِ الأوسعِ في معاملةِ فتحِ
   * الدورةِ نفسِها — لا يُخلط بإخطارِ التصعيد، ولا يعني أنَّ الرسالةَ وصلت.
   */
  readonly queuedWiderCircle: readonly OrderId[];
  /**
   * طلباتٌ لها دورةٌ حيّةٌ في القروب: تُترك لمهمّة التدوير ولا تُصعَّد. تُعدّ صراحةً
   * لأنّ «فحصتُ ولم أصعّد» بلا بيانٍ يبدو طمأنينةً وهو قد يكون عطلاً.
   */
  readonly awaitingUnsubscribed: number;
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
  const queuedNoDriver: OrderId[] = [];
  const offeredToUnsubscribed: OrderId[] = [];
  const queuedWiderCircle: OrderId[] = [];
  let alreadyEscalated = 0;
  let stillBroadcasting = 0;
  let awaitingUnsubscribed = 0;
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
     * الباب الثاني قبل البشر: مسار المشتركين انتهى، فتُنشر البطاقة في قروب غير
     * المشتركين وتُفتح دورةُ الثلاثة (٣.٤). التصعيد إلى الإسناد لا يقع إلّا بعد
     * أن يُغلق هذا الباب — نصّاً في التوجيه: «لا سائق مشترك ولا استجابة من القروب
     * غير المشترك بعد عدة دورات».
     *
     * والسبق مع مهمّة التدوير محسوم في القاعدة لا هنا: الفهرس
     * unsubscribed_negotiations_single_open يمنع دورتين مفتوحتين، فأيّهما سبق ربح
     * والآخر يقرأ CYCLE_ALREADY_OPEN ويمضي — لا قفلَ تطبيقٍ يحرس ما تحرسه القاعدة.
     */
    const published = await publishToUnsubscribedGroup(
      { orderId: order.orderId },
      deps.unsubscribed,
    );
    if (!published.ok) {
      // إخفاق النشر لا يُصعَّد فوراً: الدورة قد تكون فُتحت فعلاً، ومهمّة التدوير
      // تلتقطها عند انتهاء مهلة الجمع. تصعيدٌ هنا يقول للموظّف «لا استجابة» قبل أن
      // يرى القروبُ البطاقةَ أصلاً.
      failed += 1;
      deps.log?.("sweep.unsubscribed_publish_failed", { orderId: order.orderId, cityId });
      continue;
    }

    if (published.value.published) {
      offeredToUnsubscribed.push(order.orderId);
      /**
       * الخبرُ صارَ يُودَعُ في معاملةِ فتحِ الدورةِ نفسِها ويُرسِلُه عاملُ الصادرِ
       * (BUG-004): كان يُرسَلُ من هنا بعدَ عودةِ الدالّةِ، فإن تعطّلَ تيليجرامُ لحظتَها
       * فُتحت الدورةُ وبقيَ صاحبُ الطلبِ صامتاً بلا شيءٍ يُعيدُ المحاولةَ. والدورةُ
       * الأولى وحدَها خبرٌ، وتقولُه القاعدةُ لا هذا الملفُّ.
       */
      if (published.value.notificationQueued) queuedWiderCircle.push(order.orderId);
      continue;
    }

    const refusal = published.value.reason;
    if (refusal === "CYCLE_ALREADY_OPEN" || refusal === "ORDER_NOT_SEARCHING") {
      // دورةٌ حيّةٌ تملكها مهمّة التدوير، أو طلبٌ تغيّرت حالُه بين القراءة والكتابة.
      awaitingUnsubscribed += 1;
      continue;
    }

    /**
     * السبب يقول الحقيقة لموظّف الإسناد: من نفدت دوراتُ قروبه غير المشتركين حالُه
     * غير من لا قروبَ في مدينته أصلاً، ومن عُرِض له فتجاهلوه ليس «لا سائق في
     * المدينة» — والتصرّف يختلف باختلافها الثلاثة.
     */
    const reason: EscalationReason =
      refusal === "CYCLES_EXHAUSTED"
        ? "unsubscribed_cycles_exhausted"
        : order.hasAnyOffer
          ? "broadcast_rounds_exhausted"
          : "no_driver_at_all";

    const result = await escalateUnmatchedOrder(
      {
        orderId: order.orderId,
        reason,
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
     * إخطارُ صاحبِ الطلبِ صارَ يُودَعُ داخلَ معاملةِ أوّلِ تسليمٍ في
     * mark_escalation_delivered ويُرسِلُه عاملُ الصادرِ بعدَ الالتزامِ (BUG-004):
     * كان يُرسَلُ من هنا بعدَ عودةِ الدالّةِ، فإخفاقٌ عابرٌ في تيليجرامَ يُخرِسُ الطلبَ
     * إلى الأبدِ لأنَّ الحارسَ يمنعُ كلَّ إعادةٍ — الأثرُ يقولُ «سُلِّمت البطاقةُ»
     * وصاحبُ الطلبِ لم يُخبَر. و«رسالةٌ واحدةٌ لا اثنتان» مضمونٌ في القاعدةِ مرّتَينِ:
     * أوّلُ التسليمِ انتقالُ صفٍّ مقفولٍ، ومفتاحُ منعِ التكرارِ في صندوقِ الصادرِ.
     */
    if (result.value.notificationQueued) queuedNoDriver.push(order.orderId);
  }

  return ok({
    cityId,
    examined: stale.value.length,
    escalated,
    queuedNoDriver,
    alreadyEscalated,
    stillBroadcasting,
    offeredToUnsubscribed,
    queuedWiderCircle,
    awaitingUnsubscribed,
    failed,
  });
}
