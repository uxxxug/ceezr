/**
 * الغرض: موضعُ التركيبِ الوحيدُ لصمودِ الصادرِ (`CAP-002`/`F6-04`). البوّابةُ
 *   والعاملُ يبنيانِ المُرسِلَ في حاويتَينِ منفصلتَينِ، ولو كُرِّرَ التركيبُ فيهما
 *   لانحرفَ أحدُهما عن الآخرِ بعدَ تعديلٍ — والحدُّ الذي يختلفُ بينَ نسختَينِ ليسَ
 *   حدّاً. فههنا تُبنى الخِيارتانِ مرّةً، وتُنادى من الموضعَينِ.
 * الحالة: منفّذٌ فعلياً — `CAP-002`/`F6-04`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: عندَ إضافةِ قناةٍ صادرةٍ ثالثةٍ (بريدٌ أو رسائلُ نصّيّةٌ) تُبنى
 *   خِيارةٌ أخرى ههنا بنطاقِ دلوٍ مختلفٍ، ولا يُنسَخُ التركيبُ إلى حاويةٍ.
 */

import type { RedisClient } from "../redis/upstash.ts";
import {
  createMemoryOutboundRateBucket,
  createRedisOutboundRateBucket,
  type OutboundRateBucket,
} from "./outbound-rate-bucket.ts";
import type {
  OutboundDeadLetterSink,
  OutboundResilienceOptions,
} from "./rate-aware-telegram-sender.ts";
import { createMemoryDeadLetterSink } from "./rate-aware-telegram-sender.ts";
import { createRedisDeadLetterSink } from "./redis-dead-letter-sink.ts";

export interface OutboundResilienceDeps {
  /**
   * عميلُ Redis إن وُجِدَ. **وغيابُه ليسَ تفصيلاً**: حدُّ Bot API حدٌّ على البوتِ لا
   * على النسخةِ، فدلوٌ في ذاكرةِ كلِّ عمليةٍ يعني ضربَ الحدِّ في عددِ العملياتِ.
   * فالذاكرةُ صالحةٌ للنسخةِ الواحدةِ وللاختبارِ، وRedis هو الإنتاجُ متعدِّدَ
   * العملياتِ (والطوبولوجيا مُعلَنةٌ صراحةً في `PROCESS_TOPOLOGY` — ADR 0051).
   */
  readonly redis: RedisClient | null;
  /** يُبلَّغُ به عجزُ الدلوِ أو طابورِ الموتى. لا يُرمى منه شيءٌ. */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface OutboundResilienceParts {
  readonly bucket: OutboundRateBucket;
  readonly deadLetter: OutboundDeadLetterSink;
  readonly options: OutboundResilienceOptions;
  /** `true` متى كانَ الدلوُ مشتركاً بينَ العملياتِ فعلاً. للسجلِّ لا للمنطقِ. */
  readonly shared: boolean;
}

export function createOutboundResilience(deps: OutboundResilienceDeps): OutboundResilienceParts {
  const log = deps.log ?? (() => {});
  const bucket =
    deps.redis === null
      ? createMemoryOutboundRateBucket()
      : createRedisOutboundRateBucket(deps.redis, {
          onFailure: (detail) => log("outbound.bucket.failed", { detail }),
        });
  const deadLetter: OutboundDeadLetterSink =
    deps.redis === null
      ? createMemoryDeadLetterSink()
      : createRedisDeadLetterSink(deps.redis, {
          onFailure: (detail) => log("outbound.dead_letter.failed", { detail }),
        });

  return {
    bucket,
    deadLetter,
    shared: deps.redis !== null,
    options: {
      bucket,
      deadLetter,
      // الحدثُ يُسجَّلُ ولا يُبتلَعُ: خنقٌ متكرِّرٌ أو تخلٍّ عن رسالةٍ حرجةٍ خبرٌ
      // تشغيليٌّ يجبُ أن يُرى، وإلّا صمتَ النظامُ عن أنَّه يُسقِطُ رسائلَ.
      onEvent: (event) =>
        log(`outbound.${event.type}`, {
          operation: event.operation,
          chatId: event.chatId,
          attempt: event.attempt,
          waitMs: event.waitMs,
          detail: event.detail,
        }),
    },
  };
}
