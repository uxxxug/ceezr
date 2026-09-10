/**
 * الغرض: ناقلُ أحداثِ التتبّعِ **الموزَّع** عبر Redis Streams — بديلُ الناقلِ داخلَ
 *   العمليةِ الذي اختاره [ADR 0016](../../../../docs/adr/0016-realtime-transport.md).
 *   ينفّذُ بندَ `SCL-004`: مجرى أحداثٍ مشترك + مشتركون متعدّدون عبرَ النسخ.
 * الحالة: منفّذ فعلياً — `SCL-004` (ROADMAP §11-ب).
 * ينتمي إلى: infrastructure/tracking
 * يُتوقّع أن يستخدمه لاحقاً: `container.ts` حين يكونُ Redisُ مُعدّاً.
 *
 * ## الفكرةُ الجوهريةُ — ولماذا تعملُ Streams على عميل REST
 *
 * `XADD` و`XREAD` (بلا `BLOCK`) أمرانِ request/response: يُرسَلان ويُرَدُّ
 * جوابُهما في طلبِ HTTP واحد. فلا يحتاجانِ مقبساً مفتوحاً، خلافَ `SUBSCRIBE` الذي
 * رفضه [ADR 0016](../../../../docs/adr/0016-realtime-transport.md) لأنّ عميلَ Upstash
 * REST بلا اتصالٍ دائم. فالنشرُ والاستطلاعُ كلاهُما نداءُ REST واحدٌ لكلّ دورة.
 *
 * ## البنيةُ — غلافٌ فوقَ الناقلِ المحليّ، لا بديلٌ عنه
 *
 * يُحقنُ الناقلُ المحليُّ (`createTrackingEventBus`) فيكونُ هو fanout المحليّ
 * لمشتركي النسخةِ (SSE الإدارة، مُرحِّل العميل). وتُضافُ فوقهُ طبقةُ Streams:
 *
 *  - `subscribe()` → الناقلُ المحليّ (التصرُّفُ والتصريحُ يبقيان كما هما).
 *  - `publish(event)` → `XADD` إلى المجرى ثمّ `local.publish`. فمشتركو النسخةِ
 *    يرونَ الحدثَ فورًا، والمشتركون في نسخٍ أخرى يرونَه عبرَ الاستطلاع.
 *  - **ماسحٌ** يدورُ كلَّ `pollMs`: `XREAD` من مؤشّرٍ صاعدٍ، ويُعيدُ نشرَ ما ليسَ
 *    من مصدرِ هذه النسخةِ في الناقلِ المحليّ — فيصلُ الحدثُ إلى مشتركي النسخةِ
 *    وكأنّه نُشرَ محليّاً، فيمرُّ بتصريحِ `shouldDeliver` نفسِه.
 *
 * ## تجاوزُ المصدرِ نفسِه
 *
 * يُكتبُ مع كلِّ حدثٍ حقلُ `origin` يحملُ معرّفَ النسخةِ. فإذا قرأ الماسحُ حدثًا
 * أصدرتْه نسختُه هو تخطّاه — وإلّا لتسليمُه مرّتَين: مرّةً من `local.publish`
 * عندَ الإصدار، ومرّةً من الاستطلاع. وهذا التجاوزُ هو ما يمنعُ التكرارَ لا
 * `consumer group` (الذي يُوزّعُ الحملَ بينَ المستهلكين لا يُكرّرُه لهم جميعًا).
 *
 * ## المؤشّرُ الابتدائيُّ — من الذيلِ لا من الرأس
 *
 * أوّلُ استطلاعٍ يبدأُ من `$` (ذيلِ المجرى) لا من `0-0` (الرأس): لا تُعادُ
 * أحداثُ موقعٍ قديمةٌ لرحلةٍ ربّما انتهت. وفي الاختبارِ يُحقنُ `0-0` ليُقرأَ كلُّ
 * ما كُتبَ قبلَ بدءِ الماسحِ على مفتاحٍ نظيفٍ مُعزول.
 *
 * ## الحدودُ المُعلَنة
 *
 * ١. **لا ضمانُ تسليمٍ.** Streams تُقرأُ بالاستطلاع، فحدثٌ يُصدَرُ بينَ دورتَين
 *    قد يُفوتُ نسخةً لم تطلبهُ بعد. وللأحداثِ الحرجةِ (`session_ended`) بوابةُ
 *    الترتيبِ في المُرحِّلِ (`BUG-009`) وحدودُ المدّةِ في تلغرام — لا قيدٌ هنا.
 * ٢. **التسليمُ مرّةً على الأقلّ.** إعادةُ نشرِ حدثٍ مقروءٍ لا تكسرُ شيئاً:
 *    المُرحِّلُ يرفضُ الأقدمَ رقمًا، والقاعدةُ ذرّيّة. فالتكرارُ يُمتصُّ لا يتراكم.
 * ٣. **التقليمُ مُقنَّن.** `MAXLEN ~` يحفظُ المجرى محدودَ الحجم، فلا ينموُ
 *    بلا سقف. والرقمُ كافٍ لتجاوزِ فجوةِ الاستطلاعِ لا لتخزينِ التاريخ.
 */

import type { RedisClient } from "../../../apps/gateway/src/redis/upstash.ts";
import type { TrackingEvent } from "../../../packages/tracking/types.ts";
import type { TrackingEventBus, TrackingEventSink, TrackingSubscription } from "./event-bus.ts";

/** حقلُ مصدرِ الحدثِ في المجرى — يُفصَلُ به ما تصدره هذه النسخةُ عمّا يصدره غيرُها. */
const ORIGIN_FIELD = "origin";
/** حقلُ حمولةِ الحدثِ المُسلسَلةِ في المجرى. */
const PAYLOAD_FIELD = "payload";

/**
 * مفتاحُ المجرى المشترك — **مصدرُ حقيقةٍ واحدٌ لكلِّ العمليّاتِ**.
 *
 * `SCL-004` لا يتحقّقُ بوجودِ Streams بل بأن تقرأَ العمليّاتُ **المجرى نفسَه**.
 * وكانَ المفتاحُ نصّاً حرفيّاً مكرَّراً في `apps/gateway/src/container.ts`
 * و`apps/admin/src/container.ts`؛ وتعديلُ أحدِهما دونَ الآخرِ لا يُسقِطُ ترجمةً
 * ولا اختباراً — بل يشقُّ الناقلَ المشتركَ إلى ناقلَينِ منعزلَينِ **بصمتٍ**،
 * وهو عينُ العطبِ الذي بُنيَ `SCL-004` لإزالتِه. فالمفتاحُ ثابتٌ مُصدَّرٌ من
 * وحدةِ الناقلِ نفسِها، وحاجزُ `scripts/check-tracking-event-carrier.ts` يمنعُ
 * عودةَ النصِّ الحرفيِّ إلى أيِّ موضعٍ آخر.
 */
export const TRACKING_EVENT_STREAM_KEY = "waslah:tracking:events";

/** الحدُّ الأعلى لطولِ المجرى (`MAXLEN ~`) — كافٍ لتجاوزِ فجوةِ الاستطلاع. */
export const DEFAULT_STREAM_MAXLEN = 1_000;
/** عددُ الإدخالاتِ القصوى في طلبِ `XREAD` الواحد. */
export const DEFAULT_XREAD_COUNT = 100;
/** الفاصلُ الافتراضيُّ بينَ دوراتِ الاستطلاع. */
export const DEFAULT_POLL_MS = 250;

export interface RedisStreamTrackingEventBusDeps {
  /** الناقلُ المحليُّ الذي يُوزّعُ على مشتركي هذه النسخة. */
  readonly local: TrackingEventBus;
  /** عميلُ Redis (Upstash REST) — يُحقنُ في الاختبار. */
  readonly redis: RedisClient;
  /** مفتاحُ المجرى — يُفضّلُ أن يحملَ بادئةَ عزلِ التشغيل. */
  readonly streamKey: string;
  /** معرّفُ هذه النسخة — يُكتبُ في حقلِ `origin` ليجاوزَ الماسحُّ أحداثَ نفسِه. */
  readonly instanceId: string;
  /** الفاصلُ بينَ دوراتِ الاستطلاع. */
  readonly pollMs?: number;
  /** الحدُّ الأعلى لطولِ المجرى. */
  readonly maxlen?: number;
  /** عددُ الإدخالاتِ في طلبِ `XREAD` الواحد. */
  readonly readCount?: number;
  /** المؤشّرُ الابتدائيُّ — `$` (الذيلُ) افتراضًا، `0-0` في الاختبار. */
  readonly startCursor?: string;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface RedisStreamTrackingEventBus extends TrackingEventBus {
  /** يبدأُ ماسحَ المجرى. مُمكنٌ استدعاؤه مرّتَين بلا أثرٍ للثانية. */
  start(): void;
  /** يُوقفُ ماسحَ المجرى. مُتسامحٌ مع التكرار. */
  stop(): void;
  /** صحيحٌ بعدَ `start()` وقبلَ `stop()`. */
  readonly isPolling: boolean;
}

interface StreamEntry {
  readonly id: string;
  readonly fields: ReadonlyMap<string, string>;
}

/**
 * يُحلِّلُ استجابةَ `XREAD` الخامَ إلى إدخالاتٍ.
 *
 * شكلُ الردّ: `[[streamKey, [[id, [k, v, k, v, ...]], ...]]]` أو `null`. ويُعادُ
 * مصفوفةٌ فارغةٌ عندَ `null` أو البنيةِ غيرِ المتوقّعة — فالاستطلاعُ لا يرمي.
 */
function parseXReadResponse(raw: unknown, expectedStream: string): readonly StreamEntry[] {
  if (!Array.isArray(raw)) return [];
  // قد تكونُ الردودُ مُغلَّفةً بطبقةٍ واحدة (Upstash REST يُعيدُ القيمةَ مباشرةً).
  let outer: unknown = raw;
  if (
    Array.isArray(raw) &&
    raw.length === 1 &&
    Array.isArray(raw[0]) &&
    Array.isArray((raw[0] as unknown[])[0])
  ) {
    outer = raw[0];
  }
  if (!Array.isArray(outer)) return [];
  const entries: StreamEntry[] = [];
  for (const streamBlock of outer) {
    if (!Array.isArray(streamBlock)) continue;
    const [streamName, entryList] = streamBlock as [unknown, unknown];
    if (streamName !== expectedStream) continue;
    if (!Array.isArray(entryList)) continue;
    for (const entry of entryList) {
      if (!Array.isArray(entry)) continue;
      const [id, fieldArray] = entry as [unknown, unknown];
      if (typeof id !== "string") continue;
      if (!Array.isArray(fieldArray)) continue;
      const fields = new Map<string, string>();
      for (let i = 0; i + 1 < fieldArray.length; i += 2) {
        const k = fieldArray[i];
        const v = fieldArray[i + 1];
        if (typeof k === "string" && typeof v === "string") {
          fields.set(k, v);
        }
      }
      entries.push({ id, fields });
    }
  }
  return entries;
}

/**
 * يُحلِّلُ حمولةَ حدثٍ واحدةً من حقولِ الإدخال. يُعيدُ `null` عندَ أيِّ خللٍ في
 * البنيةِ أو في JSON — فالإدخالُ السيّئُ يُسجَّلُ ويُتجاوزُ لا يُسقطُ الماسح.
 */
function parseEventPayload(
  fields: ReadonlyMap<string, string>,
  originInstanceId: string,
): TrackingEvent | null {
  const payload = fields.get(PAYLOAD_FIELD);
  if (payload === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<TrackingEvent> & { origin?: unknown };
  if (candidate.origin === originInstanceId) return null;
  if (typeof candidate.type !== "string") return null;
  if (typeof candidate.driverId !== "string") return null;
  if (typeof candidate.sessionId !== "string") return null;
  if (typeof candidate.sequence !== "number") return null;
  if (candidate.tripId !== null && typeof candidate.tripId !== "string") return null;
  const { origin: _origin, ...event } = candidate as Record<string, unknown>;
  return event as unknown as TrackingEvent;
}

export function createRedisStreamTrackingEventBus(
  deps: RedisStreamTrackingEventBusDeps,
): RedisStreamTrackingEventBus {
  const local = deps.local;
  const redis = deps.redis;
  const streamKey = deps.streamKey;
  const instanceId = deps.instanceId;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const maxlen = deps.maxlen ?? DEFAULT_STREAM_MAXLEN;
  const readCount = deps.readCount ?? DEFAULT_XREAD_COUNT;
  const startCursor = deps.startCursor ?? "$";
  const log = deps.log ?? ((): void => undefined);

  let cursor = startCursor;
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let started = false;

  const publish = async (event: TrackingEvent): Promise<void> => {
    // ١) النشرُ المحليُّ أوّلاً: مشتركو هذه النسخةِ يرونَ الحدثَ فورًا، ولا
    //    يعتمدون على دورةِ الاستطلاعِ القادمة.
    await local.publish(event);

    // ٢) الإيداعُ في المجرى لتبقيه النسخُ الأخرى. والإخفاقُ هنا لا يُسقطُ الحدثَ
    //    محليّاً (قد صار عندَ المشتركين): يُسجَّلُ ويُتابَع، فالاستطلاعُ في النسخِ
    //    الأخرى يلتقطُ أحداثًا لاحقةً ولو فاتَه هذا.
    const payload = JSON.stringify({ ...event, origin: instanceId });
    const result = await redis.command([
      "XADD",
      streamKey,
      "MAXLEN",
      "~",
      String(maxlen),
      "*",
      ORIGIN_FIELD,
      instanceId,
      PAYLOAD_FIELD,
      payload,
    ]);
    if (!result.ok) {
      log("tracking.stream_publish_failed", {
        streamKey,
        kind: result.error.kind,
        detail: result.error.detail,
      });
    }
  };

  const poll = async (): Promise<void> => {
    if (polling) return; // لا تداخلُ دورات.
    polling = true;
    try {
      const result = await redis.command([
        "XREAD",
        "COUNT",
        String(readCount),
        "STREAMS",
        streamKey,
        cursor,
      ]);
      if (!result.ok) {
        log("tracking.stream_poll_failed", {
          streamKey,
          kind: result.error.kind,
          detail: result.error.detail,
        });
        return;
      }
      const entries = parseXReadResponse(result.value, streamKey);
      if (entries.length === 0) return;
      for (const entry of entries) {
        cursor = entry.id; // تقدُّمٌ رتيب: كلُّ معرّفٍ أكبرُ من سابقِه في Streams.
        const event = parseEventPayload(entry.fields, instanceId);
        if (event === null) {
          log("tracking.stream_entry_skipped", { streamKey, entryId: entry.id });
          continue;
        }
        // إعادةُ النشرِ في الناقلِ المحليّ تمرُّ بتصريحِ `shouldDeliver` نفسِه،
        // فلا يتسلّلُ حدثٌ إلى مشتركٍ غيرِ مصرَّحٍ له.
        await local.publish(event);
      }
    } catch (error) {
      // أيُّ عطلٍ غيرِ متوقّعٍ لا يُسقطُ الماسح: يُسجَّلُ وتُكملُ الدورةُ التالية.
      log("tracking.stream_poll_error", { detail: String(error) });
    } finally {
      polling = false;
    }
  };

  const start = (): void => {
    if (started) return;
    started = true;
    timer = setInterval(() => {
      void poll();
    }, pollMs);
  };

  const stop = (): void => {
    started = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    polling = false;
  };

  return {
    subscribe: (subscription: TrackingSubscription, sink: TrackingEventSink): (() => void) =>
      local.subscribe(subscription, sink),
    get subscriberCount(): number {
      return local.subscriberCount;
    },
    publish,
    start,
    stop,
    get isPolling(): boolean {
      return started;
    },
  };
}
