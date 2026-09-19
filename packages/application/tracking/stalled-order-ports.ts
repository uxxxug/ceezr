/**
 * الغرضُ: `F12-04` — عقدُ قراءةِ الطلباتِ العالقةِ. **قراءةٌ محضةٌ بلا إصلاحٍ**.
 * ينتمي إلى: packages/application/tracking
 * يُستخدم من: `apps/workers/src/jobs/detect-stalled-orders.ts` ·
 *   `packages/infrastructure/tracking/stalled-order-adapters.ts`.
 *
 * ## ولِمَ لا فعلَ في هذا العقدِ
 *
 * الطلبُ العالقُ عَطَبٌ **تجاريُّ التبعةِ**: إلغاؤه يمسُّ الراكبَ، وإفشالُه يمسُّ
 * سجلَّ السائقِ، وتحميلُ أحدٍ تبعتَه سياسةٌ (`F2-05`: العقوبةُ بالسياقِ لا بالحدثِ).
 * فالعقدُ يكشفُ ويُصعِّدُ، والقرارُ عندَ صاحبِه لا في مهمّةٍ دوريّةٍ.
 */
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/**
 * الإشارةُ التي قِيسَ بها السكونُ — تُنشَرُ كي لا يُقرأَ الرقمُ بلا نسبٍ.
 *
 * **ومعجمٌ مغلقٌ في زمنِ التشغيلِ لا نوعٌ وحدَه**: النوعُ يختفي عندَ الترجمةِ،
 * والصفُّ يأتي من القاعدةِ في زمنِ التشغيلِ. فلو أضافَ أحدٌ حكماً ثالثاً في
 * الهجرةِ ولم يُضِفْه ههنا، لعبرَ نصّاً مجهولاً إلى سجلِّ المُشغِّلِ بلا صوتٍ.
 */
export const STALL_SIGNAL_SOURCES = ["DRIVER_LOCATION", "ORDER_TOUCHED"] as const;

export type StallSignalSource = (typeof STALL_SIGNAL_SOURCES)[number];

/** أحكامُ الحَكَمِ الثلاثةُ كما تردُّها `order_stall_state` — معجمٌ مغلقٌ. */
export const STALL_VERDICTS = ["LIVE", "STALLED", "NOT_ACTIVE"] as const;

export type StallVerdict = (typeof STALL_VERDICTS)[number];

/** هل هذا النصُّ إشارةٌ معروفةٌ؟ نصٌّ مجهولٌ يُعلَنُ ولا يُمرَّرُ صامتاً. */
export function isKnownStallSignalSource(value: string): value is StallSignalSource {
  return (STALL_SIGNAL_SOURCES as readonly string[]).includes(value);
}

/** صفُّ طلبٍ عَلِقَ كما تقرؤُه `detect_stalled_orders`. */
export interface StalledOrderRow {
  readonly orderId: OrderId;
  readonly status: string;
  /** ثوانيُ السكونِ منذُ آخرِ إشارةِ حياةٍ. */
  readonly idleSeconds: number;
  /** المهلةُ التي جاوزَها، بالدقائقِ. */
  readonly thresholdMinutes: number;
  readonly signalSource: StallSignalSource | string;
  readonly lastSignalAt: string;
}

export interface StalledOrderRpcPort {
  /** يُحصي طلباتَ مدينةٍ العالقةَ، أطولَ سكوناً أوّلاً. لا يُغيِّرُ شيئاً. */
  readonly listStalled: (
    cityId: CityId,
    limit: number,
  ) => Promise<Result<readonly StalledOrderRow[], PortFailureError>>;
}
