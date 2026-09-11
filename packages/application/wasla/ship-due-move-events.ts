/**
 * الغرض: `W-5` — **شوطُ تصريفٍ محدودٌ** لصندوقِ صادرِ أحداثِ MOVE: يُنادي
 *    `deliverOnce` صفّاً صفّاً حتى يفرغَ المستحقُّ أو يبلغَ سقفَ الشوطِ، ويردُّ
 *    حصيلةً مُصنَّفةً (مُسلَّمٌ · مُعادٌ · ميّتٌ · مرفوضٌ عقديّاً) تُكتَبُ في سجلِّ
 *    العاملِ سطراً واحداً.
 * الحالة: منفّذ فعلياً — 2026-09-12 · مقيسٌ باختباراتِ وحدةٍ واختبارِ تكاملٍ.
 * ينتمي إلى: application/wasla
 * يُستخدم من: `apps/workers/src/container.ts` (مهمّةُ `ship-move-events`).
 * ملاحظات مستقبلية: لا توازيَ ههنا عن قصدٍ — انظر أدناه.
 *
 * ## لِمَ سقفٌ للشوطِ ولِمَ توقُّفٌ عندَ أوّلِ عطلِ بابٍ
 *
 * مهمّةٌ دوريّةٌ بلا سقفٍ تصيرُ حلقةً لا تنتهي إن كتبَ المُنتِجُ أسرعَ من
 * المُستهلِكِ، فيَحرِمُ شوطٌ واحدٌ بقيّةَ المهامِّ من العاملِ ويُخفي التراكمَ عن
 * القياسِ. والسقفُ يجعلُ التراكمَ ظاهراً في عمقِ الصندوقِ وعمرِ أقدمِ صفٍّ — وهما
 * مقيسانِ مرصودانِ — لا مخفيّاً في شوطٍ طويلٍ.
 *
 * وعطلُ بابٍ (`kind: "port"`) يُوقِفُ الشوطَ فوراً: إن كانتِ القاعدةُ عاطلةً فلا
 * معنى لمئةِ نداءٍ فاشلٍ بعدَها، والصفوفُ محفوظةٌ يُستأنَفُ عليها الشوطُ التالي.
 * أمّا الإخفاقُ في التسليمِ نفسِه فلا يُوقِفُ الشوطَ: `deliverOnce` يكتبُه في
 * الصفِّ (إعادةٌ بتراجعٍ أو موتٌ) ويعودُ ناجحاً، فبقيّةُ الصفوفِ لا تُحبَسُ بعطلِ
 * صفٍّ واحدٍ.
 *
 * ولا توازيَ: الحجزُ في القاعدةِ يُخرِجُ صفّاً واحداً لكلِّ نداءٍ بـ`skip locked`،
 * فالتوازي يُضاعِفُ نداءاتِ الحجزِ لا مُعدَّلَ التسليمِ ما لم يُرفَعْ سقفُ
 * التزامنِ في الصندوقِ نفسِه، وذاكَ قرارٌ يُقاسُ عندَ ظهورِ تراكمٍ حقيقيٍّ لا
 * قبلَه.
 */

import type { Result } from "../../shared/result/index.ts";
import { err, isErr, ok } from "../../shared/result/index.ts";
import type {
  FulfillmentLifecycle,
  LifecycleFailure,
  MoveEventShipper,
} from "./fulfillment-lifecycle.ts";

/** حصيلةُ شوطٍ — كلُّ عدّادٍ صفٌّ فُصِلَ فيه، فمجموعُها = ما حُجِزَ. */
export interface ShipDueReport {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly dead: number;
  readonly contractRejected: number;
  /** بلغَ الشوطُ سقفَه ولمّا يفرغِ المستحقُّ — دليلُ تراكمٍ لا خطأٌ. */
  readonly truncated: boolean;
}

export interface ShipDueMoveEventsInput {
  readonly lifecycle: FulfillmentLifecycle;
  readonly shipper: MoveEventShipper;
  /** سقفُ الصفوفِ في الشوطِ الواحدِ — يلزمُ أن يكونَ عدداً صحيحاً موجباً. */
  readonly maxEvents: number;
}

export async function shipDueMoveEvents(
  input: ShipDueMoveEventsInput,
): Promise<Result<ShipDueReport, LifecycleFailure>> {
  let claimed = 0;
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  let contractRejected = 0;

  const limit = Math.max(1, Math.floor(input.maxEvents));

  while (claimed < limit) {
    const report = await input.lifecycle.deliverOnce(input.shipper);
    if (isErr(report)) return err(report.error);
    if (report.value === null) {
      return ok({ claimed, delivered, retried, dead, contractRejected, truncated: false });
    }

    claimed += 1;
    if (report.value.verdict === "delivered") delivered += 1;
    else if (report.value.verdict === "retry") retried += 1;
    else if (report.value.verdict === "dead") dead += 1;
    else contractRejected += 1;
  }

  /**
   * بلوغُ السقفِ لا يُثبِتُ فراغَ المستحقِّ، فلا يُقالُ `truncated: false` رجماً:
   * تُقالُ الحقيقةُ المعروفةُ — حُجِزَ السقفُ كلُّه، فقد يكونَ ثَمَّ بقيّةٌ.
   */
  return ok({ claimed, delivered, retried, dead, contractRejected, truncated: true });
}
