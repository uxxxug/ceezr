/**
 * الغرض: شوطُ تسليم البثّ الجماعي لمدينةٍ واحدة. يحجز دفعةً بحدّ المدينة، ينشرها
 *   واحدةً واحدة، ويُعلن نتيجةَ كلٍّ منها في القاعدة قبل أن ينتقل.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/application/broadcast
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/deliver-broadcasts.ts
 * ملاحظات مستقبلية: التسلسل مقصود لا مؤقّت — انظر التعليق أسفل الحلقة.
 */
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { BroadcastAudience, BroadcastDeliveryPort, BroadcastPublisher } from "./ports.ts";

export interface DeliverBroadcastDeps {
  readonly deliveries: BroadcastDeliveryPort;
  /**
   * ناشرٌ لكلّ جمهور: تلغرام يرفض أن يبتدئ بوتٌ محادثةً مع من لم يفتحها معه، فبوتُ
   * السائق لا يستطيع مخاطبة راكبٍ ولا العكس. ناشرٌ واحد للاثنين كان سيُردّ بـ403
   * على الجمهور كلّه — بلا رسالةٍ تصل وبلا عطلٍ يُوقظ أحداً.
   */
  readonly publishers: Readonly<Record<BroadcastAudience, BroadcastPublisher>>;
}

export interface BroadcastBatchOutcome {
  readonly claimed: number;
  readonly sent: number;
  /** أُخفقت نهائياً: لن تُعاد. */
  readonly failed: number;
  /** أُخفقت عابراً: أُعيدت `pending` بموعدٍ جديد. */
  readonly retried: number;
}

export async function deliverBroadcastBatch(
  cityId: string,
  deps: DeliverBroadcastDeps,
): Promise<Result<BroadcastBatchOutcome, PortFailureError>> {
  const claimed = await deps.deliveries.claim(cityId);
  if (!claimed.ok) return claimed;

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const recipient of claimed.value) {
    const published = await deps.publishers[recipient.audience].publish(recipient);
    const finished = await deps.deliveries.finish({
      recipientId: recipient.recipientId,
      claimToken: recipient.claimToken,
      messageId: published.ok ? published.value.messageId : null,
      delivered: published.ok,
      permanent: published.ok ? false : published.error.permanent,
      errorCode: published.ok ? null : published.error.code,
    });
    // فشلُ `finish` وحده يُسقط الشوط: الصفّ عالقٌ في `sending` بلا موعد، وهذه
    // حالةٌ لا يجوز المضيّ فوقها — الصفوف التالية ستُحجَز فوق قاعدةٍ مجروحة.
    // أمّا فشلُ النشر فقد أُعلن في القاعدة وأُعيد الصفُّ سليماً.
    if (!finished.ok) return finished;
    if (published.ok) {
      sent += 1;
    } else if (published.error.permanent || recipient.attempts >= recipient.maxAttempts) {
      failed += 1;
    } else {
      retried += 1;
    }
  }

  /**
   * الإرسالُ تسلسليّ لا متوازٍ، وهذا قرارٌ لا تقصير.
   *
   * لتلغرام حدُّ رسائل، ومن يتجاوزه يُردّ بـ429 على الدفعة كلّها — فتوازٍ يبدو
   * أسرع يُنتج شوطاً كامله معادٌ إلى `pending`، أي أبطأ فعلياً وأكثر ضجيجاً.
   * وحجمُ الدفعة يُقرأ من إعداد المدينة، فضبطُ السرعة تشغيليّ لا نشرُ كود.
   */
  return ok({ claimed: claimed.value.length, sent, failed, retried });
}
