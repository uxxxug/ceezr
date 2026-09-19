/**
 * الغرضُ: `F12-04` — مهمّةٌ دوريّةٌ **تكشفُ الطلباتَ العالقةَ وتُصعِّدُها سطراً
 *   مُهيكَلاً**، ولا تُغيِّرُ حالةَ طلبٍ ولا تُلغي ولا تُفشِلُ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-19. والبندُ `F12-04` **يبقى `[~]`**.
 * ينتمي إلى: apps/workers/src/jobs
 * يُستخدم من: `apps/workers/src/container.ts` (كلَّ ١٢٠ ثانيةً لكلِّ مدينةٍ).
 *
 * ## ولِمَ كشفٌ لا إصلاحٌ — وهذا أهمُّ سطرٍ في الملفِّ
 *
 * الطلبُ العالقُ ليسَ صفّاً فاسداً يُنظَّفُ: هوَ راكبٌ ينتظرُ وسائقٌ مُلتزِمٌ.
 * وإلغاؤه آليّاً يُلغي رحلةَ إنسانٍ قد تكونُ جاريةً بحقٍّ (سائقٌ في نفقٍ، أو
 * هاتفٌ نفدَت بطاريتُه)، وإفشالُه يكتبُ في سجلِّ سائقٍ ما لم يجنِه، وتحميلُ أحدٍ
 * تبعتَه **سياسةٌ تجاريّةٌ** (`F2-05`: العقوبةُ بالحالةِ والطابعِ والسياقِ لا
 * بالحدثِ). فلا يُخترَعُ ههنا قرارٌ لم يُتَّخَذْ.
 *
 * والذي يُنجِزُه الكشفُ وحدَه معتبَرٌ: طلبٌ عَلِقَ كانَ **لا يراهُ أحدٌ** حتّى
 * يشتكيَ راكبٌ، وصارَ يُكتَبُ سطراً مُهيكَلاً بعمرِه وإشارتِه ومهلتِه. وبه يُغلَقُ
 * أيضاً بابُ رابطِ تتبّعٍ يبثُّ موضعَ سائقٍ عن رحلةٍ عَلِقَت — والحَكَمُ في
 * `tracking_link_lifetime` لا ههنا (فلا تُفتَحُ ثقبةٌ إن تعطّلَت هذه المهمّةُ).
 *
 * ## ولا يُعتمَدُ على هذه المهمّةِ أمنياً
 *
 * على سُنّةِ `expire-tracking-tokens.ts`: لو سقطَ العاملُ أسبوعاً فلن يبثَّ رابطٌ
 * موضعَ رحلةٍ عالقةٍ، لأنَّ `tracking_link_lifetime` تُجيبُ **لحظةَ القراءةِ**
 * بحكمِ `order_stall_state`. فهذه المهمّةُ **عينُ مُشغِّلٍ** لا حدُّ أمنٍ.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type {
  StalledOrderRow,
  StalledOrderRpcPort,
} from "../../../../packages/application/tracking/stalled-order-ports.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

/**
 * حدُّ الدفعةِ. تقنيٌّ لا تجاريٌّ: سقفٌ على حجمِ السطرِ المكتوبِ وعلى العبارةِ،
 * وما زادَ يُقرأُ في النبضةِ التاليةِ. ومئةُ طلبٍ عالقٍ في مدينةٍ واحدةٍ حالةٌ
 * تستدعي إنساناً لا دفعةً أكبرَ.
 */
export const STALLED_ORDER_BATCH = 100;

export interface DetectStalledOrdersDependencies {
  readonly stalled: StalledOrderRpcPort;
  /**
   * كاتبُ التصعيدِ. سطرٌ مُهيكَلٌ لكلِّ طلبٍ عالقٍ — لا سطرٌ واحدٌ يجمعُ العددَ:
   * عددٌ بلا معرِّفاتٍ لا يُبحَثُ به عن طلبٍ بعينِه، والسطرُ المُهيكَلُ يُصفّى.
   *
   * **ولا يُمرَّرُ رمزُ الحدثِ ههنا**: حارسُ `F8-03` يشترطُ أن يكونَ أوّلُ وسيطٍ
   * في نداءِ التسجيلِ نصّاً **حرفيّاً**، فرمزٌ يسافرُ في متغيّرٍ يُخرِجُ السطرَ
   * من حكمِ الحاجزِ. فالحقولُ ههنا والرمزُ حرفيٌّ عندَ مُنادِيها.
   */
  readonly escalate: (fields: Record<string, unknown>) => void;
}

export interface DetectStalledOrdersReport {
  readonly cityId: CityId;
  /** عددُ الطلباتِ العالقةِ في هذه النبضةِ. */
  readonly stalled: number;
  /** أطولُ سكونٍ وُجِدَ، أو `null` إن لم يَعلَقْ شيءٌ. */
  readonly worstIdleSeconds: number | null;
}

export async function detectStalledOrders(
  cityId: CityId,
  deps: DetectStalledOrdersDependencies,
): Promise<Result<DetectStalledOrdersReport, PortFailureError>> {
  const result = await deps.stalled.listStalled(cityId, STALLED_ORDER_BATCH);
  if (!result.ok) return result;

  const rows: readonly StalledOrderRow[] = result.value;
  for (const row of rows) {
    deps.escalate({
      city_id: cityId,
      order_id: row.orderId,
      order_status: row.status,
      idle_seconds: row.idleSeconds,
      threshold_minutes: row.thresholdMinutes,
      signal_source: row.signalSource,
      last_signal_at: row.lastSignalAt,
    });
  }

  // الصفوفُ مُرتَّبةٌ بأطولِ سكونٍ أوّلاً في القاعدةِ، فالأوّلُ هوَ الأسوأُ —
  // ولا يُعادُ الفرزُ ههنا كي لا يكونَ للترتيبِ موضعانِ.
  const worst = rows.length > 0 ? (rows[0]?.idleSeconds ?? null) : null;

  return { ok: true, value: { cityId, stalled: rows.length, worstIdleSeconds: worst } };
}
