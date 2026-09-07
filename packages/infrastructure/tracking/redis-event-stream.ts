/**
 * الغرض: SCL-004 — مجرى أحداث مشترك عبر Redis Streams بدلاً من ناقل العملية وحده.
 *   كلُّ نسخةٍ تنشر أحداثها إلى Stream في Redis، وكلُّ نسخةٍ تستهلك منه وتُسلّم
 *   لمشتركيها المحليّين. والناقل المحليّ يبقى للتسليم الفوري داخل النسخة،
 *   والـStream يُضيف التسليم عبر النسخ.
 * الحالة: منفّذ فعلياً — SCL-004.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: F4-03 (مجرى مشترك بديل)، F4-06 (خريطة المشرف)
 *
 * ## لماذا Redis Streams لا Pub/Sub
 *
 * Upstash عبر REST فقط: `SUBSCRIBE` اتصالٌ دائم لا يُمثَّل في REST (ADR-0016).
 * و`XADD`/`XREAD` طلبٌ/استجابةٌ في كلِّ نداء HTTP، فالاستهلاك استطلاعٌ لا مقبس.
 *
 * ## التسليم مرّتين لا مرّة
 *
 * النسخة التي تنشر حدثاً تُسلّمه فوراً لمشتركيها المحليّين (الناقل المحليّ)، ثم
 * تُضيفه إلى الـStream. والنسخة نفسها قد تقرأه من الـStream في استطلاعها التالي،
 * فيُسلَّم مرّتين. والتجاوز: كلُّ حدثٍ يُنشر محليّاً يُسجَّل معرّفُه في مجموعةٍ
 * صغيرة (آخر ٢٠٠)، فإذا قرأه المستهلك ورآه فيها تخطّاه — فقد سُلِّم محليّاً.
 */

import type { TrackingEvent } from "../../tracking/types.ts";

/**
 * واجهةٌ مطابقةٌ لـ`RedisClient` في `apps/gateway/src/redis/upstash.ts`.
 * نُعرّفها هنا لا نستوردها من التطبيق: البنية التحتيةّة لا تعتمد على التطبيق.
 */
interface RedisCommandResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly detail: string; readonly kind: string };
}

interface RedisClientLike {
  command(args: readonly (string | number)[]): Promise<RedisCommandResult>;
}

/** اسم الـStream في Redis. */
const STREAM_KEY = "ceezr:tracking:events";

/** حدّ مجموعة معرّفات الأحداث المنشورة محليّاً (لتخطّي التسليم المزدوج). */
const LOCAL_ORIGIN_BUFFER_SIZE = 200;

/** نوع إدخال الـStream كما يُرجعه XREADGROUP. */
type StreamEntry = readonly [string, readonly string[]];
type StreamResult = readonly [string, readonly StreamEntry[]] | null;

/**
 * مجرى الأحداث المشترك عبر Redis Streams.
 *
 * ينشر بالـXADD ويستهلك بالـXREADGROUP مع مجموعة مستهلكين باسم النسخة. وكلُّ نسخةٍ
 * تُنشئ مجموعتها عند الإقلاع، فتتقدّم كلٌّ باستقلال.
 */
export interface RedisTrackingEventStream {
  /** ينشر حدثاً إلى الـStream. لا يرمي. */
  publish(event: TrackingEvent): Promise<void>;
  /**
   * يبدأ حلقة استطلاع الـStream. يُسلّم الأحداث إلى `onEvent` ما لم تكن منشورةً
   * محليّاً. يعيد دالة الإيقاف.
   */
  startConsumer(
    consumerGroup: string,
    consumerName: string,
    onEvent: (event: TrackingEvent) => Promise<void>,
  ): () => void;
  /** هل الـStream موصول وقابل للاستخدام؟ */
  readonly connected: boolean;
}

export interface RedisTrackingEventStreamOptions {
  readonly redis: RedisClientLike;
  readonly pollIntervalMs?: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export function createRedisTrackingEventStream(
  options: RedisTrackingEventStreamOptions,
): RedisTrackingEventStream {
  const { redis } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const log = options.log ?? (() => undefined);

  /**
   * معرّفات الأحداث المنشورة محليّاً — لتخطّي التسليم المزدوج.
   * خريطةٌ مرتّبة بحسب الإدراج، تُقتطع أقدم العناصر عند تجاوز الحدّ.
   */
  const localOriginIds = new Set<string>();
  const localOriginOrder: string[] = [];

  const rememberLocalOrigin = (id: string): void => {
    localOriginIds.add(id);
    localOriginOrder.push(id);
    if (localOriginOrder.length > LOCAL_ORIGIN_BUFFER_SIZE) {
      const oldest = localOriginOrder.shift();
      if (oldest !== undefined) localOriginIds.delete(oldest);
    }
  };

  const isLocalOrigin = (id: string): boolean => localOriginIds.has(id);

  let stopped = false;

  return {
    get connected() {
      return true;
    },

    publish: async (event) => {
      const serialized = JSON.stringify(event);
      const result = await redis.command([
        "XADD",
        STREAM_KEY,
        "*",
        "type",
        event.type,
        "data",
        serialized,
      ]);
      if (result.ok) {
        const id = result.value as string;
        rememberLocalOrigin(id);
      } else {
        log("tracking.redis_stream_publish_failed", { detail: result.error?.detail ?? "unknown" });
      }
    },

    startConsumer: (consumerGroup, consumerName, onEvent) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const ensureGroup = async (): Promise<void> => {
        /** XGROUP CREATE يتطلّب وجود الـStream أوّلاً. */
        const result = await redis.command([
          "XGROUP",
          "CREATE",
          STREAM_KEY,
          consumerGroup,
          "$",
          "MKSTREAM",
        ]);
        if (!result.ok && result.error?.kind !== "redis") {
          log("tracking.redis_stream_group_create_failed", {
            group: consumerGroup,
            detail: result.error?.detail ?? "unknown",
          });
        }
      };

      const poll = async (): Promise<void> => {
        if (stopped) return;

        const result = await redis.command([
          "XREADGROUP",
          "GROUP",
          consumerGroup,
          consumerName,
          "COUNT",
          "100",
          "STREAMS",
          STREAM_KEY,
          ">",
        ]);

        if (!result.ok) {
          log("tracking.redis_stream_read_failed", { detail: result.error?.detail ?? "unknown" });
          timer = setTimeout(poll, pollIntervalMs);
          return;
        }

        const entries = result.value as StreamResult;
        if (entries !== null) {
          for (const entry of entries) {
            const messages = (entry[1] ?? []) as readonly StreamEntry[];
            for (const message of messages) {
              const id: string = message[0] ?? "";
              const fields = (message[1] ?? []) as readonly string[];

              if (isLocalOrigin(id)) {
                /** تخطّي — سُلِّم محليّاً عند النشر. */
                await redis.command(["XACK", STREAM_KEY, consumerGroup, id]).catch(() => undefined);
                continue;
              }

              /** استخراج الحمولة من الحقول. */
              const fieldMap = new Map<string, string>();
              for (let i = 0; i < fields.length; i += 2) {
                const key = fields[i] ?? "";
                const val = fields[i + 1] ?? "";
                if (key !== undefined && val !== undefined) {
                  fieldMap.set(key, val);
                }
              }
              const data = fieldMap.get("data");
              if (data === undefined || data === "") {
                await redis.command(["XACK", STREAM_KEY, consumerGroup, id]).catch(() => undefined);
                continue;
              }

              try {
                const event = JSON.parse(data) as TrackingEvent;
                await onEvent(event);
              } catch (error) {
                log("tracking.redis_stream_decode_failed", {
                  id,
                  detail: String(error),
                });
              }

              await redis.command(["XACK", STREAM_KEY, consumerGroup, id]).catch(() => undefined);
            }
          }
        }

        timer = setTimeout(poll, pollIntervalMs);
      };

      ensureGroup().then(() => {
        timer = setTimeout(poll, pollIntervalMs);
      });

      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
      };
    },
  };
}
