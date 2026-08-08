/**
 * الغرض: عميل Upstash Redis عبر واجهته REST — أمرٌ واحد في طلب HTTP واحد، بمهلة
 *   قصيرة، وبلا رمي استثناء: كل نتيجة Result.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.2.
 * ينتمي إلى: apps/gateway/src/redis
 * يُتوقع أن يستخدمه لاحقاً: مخزن الجلسات (د.2)، وحدّ معدّل الويبهوك (د.4).
 * ملاحظات مستقبلية: لو احتيج أمرٌ ذرّي مركّب (Lua) فمنفذ /eval نفس الشكل، وتُضاف
 *   دالّة ثانية هنا لا عميل ثانٍ.
 */

import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";

/**
 * مهلة تقنية لا تجارية. Redis الذي لا يجيب في ثانيتين معطّل عملياً، وانتظاره أطول
 * يعني حجز خيط الويبهوك بينما تلغرام ينتظر ردّاً — فالانتظار هنا يُنتج عطلاً ثانياً.
 */
export const REDIS_TIMEOUT_MS = 2000;

export interface RedisFailure {
  readonly kind: "timeout" | "network" | "http" | "redis" | "malformed";
  readonly detail: string;
}

export interface RedisClient {
  /** أمر Redis واحد كمصفوفة: ["GET", key]. يعيد الحمولة الخام كما ردّها Upstash. */
  command(args: readonly (string | number)[]): Promise<Result<unknown, RedisFailure>>;
}

export interface UpstashOptions {
  readonly url: string;
  readonly token: string;
  readonly timeoutMs?: number;
  /** يُحقن في الاختبار بدل الشبكة، فيُثبَت المحوّل كاملاً بلا Redis حقيقي. */
  readonly fetchImpl?: typeof fetch;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Upstash يردّ دائماً بجسم JSON فيه `result` عند النجاح أو `error` عند فشل الأمر
 * نفسه — و«فشل الأمر» غير «فشل الشبكة»: الأول خطأ منّا في صياغة الأمر، والثاني
 * انقطاع. فُصلا في `kind` لأن أحدهما يُصلَح بالكود والآخر بالانتظار.
 */
export function createUpstashRedis(options: UpstashOptions): RedisClient {
  const base = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? REDIS_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    command: async (args): Promise<Result<unknown, RedisFailure>> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(base, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(args.map(String)),
          signal: controller.signal,
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        return err({
          kind: aborted ? "timeout" : "network",
          detail: aborted ? `تجاوز ${timeoutMs} ملي ثانية` : describe(error),
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        return err({ kind: "http", detail: `HTTP ${response.status}` });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        return err({ kind: "malformed", detail: describe(error) });
      }

      if (typeof payload !== "object" || payload === null) {
        return err({ kind: "malformed", detail: "الجسم ليس كائناً" });
      }
      const body = payload as { result?: unknown; error?: unknown };
      if (typeof body.error === "string") {
        return err({ kind: "redis", detail: body.error });
      }
      if (!("result" in body)) {
        return err({ kind: "malformed", detail: "لا حقل result في الجواب" });
      }
      return ok(body.result);
    },
  };
}
