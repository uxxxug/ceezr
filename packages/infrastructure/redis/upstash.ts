/**
 * الغرض: عميل Upstash Redis عبر واجهته REST — أمرٌ واحد في طلب HTTP واحد، بمهلة
 *   قصيرة، وبلا رمي استثناء: كل نتيجة Result.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.2.
 * ينتمي إلى: infrastructure/redis — نُقِلَ من `apps/gateway/src/redis` في CAP-002
 *   لأنَّ العاملَ الخلفيَّ صارَ يحتاجُ دلوَ الحدِّ المشتركَ، واستيرادُ تطبيقٍ من
 *   تطبيقٍ ممنوعٌ في هذه البنيةِ. والمسارُ القديمُ بقيَ مُصدِّراً معيداً فلم يتغيّر
 *   سطرٌ في ستّةَ عشرَ مُستورِداً.
 * يُتوقع أن يستخدمه لاحقاً: مخزن الجلسات (د.2)، وحدّ معدّل الويبهوك (د.4).
 * ملاحظات مستقبلية: لو احتيج أمرٌ ذرّي مركّب (Lua) فمنفذ /eval نفس الشكل، وتُضاف
 *   دالّة ثانية هنا لا عميل ثانٍ.
 */

import {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  type DependencyGuard,
} from "../../shared/resilience/dependency-guard.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/**
 * مهلة تقنية لا تجارية. Redis الذي لا يجيب في ثانيتين معطّل عملياً، وانتظاره أطول
 * يعني حجز خيط الويبهوك بينما تلغرام ينتظر ردّاً — فالانتظار هنا يُنتج عطلاً ثانياً.
 * **والرقمُ مقروءٌ من ميزانيّةِ الاعتماديّةِ لا مكتوبٌ هنا ثانيةً** (`F8-04`): رقمانِ
 * لمعنىً واحدٍ يفترقانِ بأوّلِ تعديلٍ، فيصيرُ المُعلَنُ غيرَ المُطبَّقِ صامتاً.
 */
export const REDIS_TIMEOUT_MS = DEPENDENCY_BUDGETS.redis.timeoutMs;

/**
 * **و`open` و`saturated` مُسمّيانِ لا مُدمَجانِ في `timeout`** (`F8-04`): الأوّلُ
 * يعني أنَّ القاطعَ مفتوحٌ فالنداءُ لم يُرسَلْ أصلاً، والثاني ضيقاً عندَنا لا عندَ
 * Redis. ومن سوّى بينَهما وبينَ تجاوزِ المهلةِ قرأَ في اللوحةِ «Redis بطيءٌ» وهوَ
 * لم يُسأَلْ.
 */
export interface RedisFailure {
  readonly kind: "timeout" | "network" | "http" | "redis" | "malformed" | "open" | "saturated";
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
  /**
   * حاجزُ الاعتماديّةِ (`F8-04`). **يُحقَنُ في الاختبارِ لا يُلغى**: مَن مرَّرَ
   * `null` هنا عطَّلَ القاطعَ والحدَّ، ولذلكَ لا يُقبَلُ `null` — والاختبارُ
   * يُمرِّرُ حاجزاً بميزانيّةٍ مصغَّرةٍ وساعةٍ مُمرَّرةٍ.
   */
  readonly guard?: DependencyGuard;
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
  const guard =
    options.guard ??
    createDependencyGuard({
      dependency: "redis",
      ...(options.timeoutMs === undefined
        ? {}
        : { budget: { ...DEPENDENCY_BUDGETS.redis, timeoutMs: options.timeoutMs } }),
    });

  return {
    command: async (args): Promise<Result<unknown, RedisFailure>> => {
      // المهلةُ صارت **في الحاجزِ** لا هنا: مؤقّتانِ لميزانيّةٍ واحدةٍ يفترقانِ.
      // والإشارةُ تُمرَّرُ إلى `fetch` لتُطاعَ فعلاً فيُلغى النداءُ لا يُهمَلَ.
      const outcome = await guard
        .run(
          async (signal) => {
            return await doFetch(base, {
              method: "POST",
              headers: {
                authorization: `Bearer ${options.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(args.map(String)),
              signal,
            });
          },
          {
            // **`5xx` إخفاقٌ عندَ القاطعِ ولو وصلَ جواباً**: `fetch` لا يرمي على
            // حالةٍ، فبلا هذا التصنيفِ كانَ Redis يردُّ `503` ألفَ مرّةٍ ولا يُفتَحُ
            // القاطعُ أبداً. و`4xx` **لا يُعَدُّ**: رمزٌ باطلٌ أو أمرٌ مرفوضٌ عيبُنا
            // نحنُ، وفتحُ القاطعِ عليه يحجُبُ Redis سليماً.
            failed: (response: Response) => response.status >= 500,
          },
        )
        .catch((error: unknown) => ({ thrown: error }) as const);

      if ("thrown" in outcome) {
        return err({ kind: "network", detail: describe(outcome.thrown) });
      }
      if (!outcome.admitted) {
        const reason = outcome.rejection.reason;
        return err({
          kind: reason,
          detail:
            reason === "timeout"
              ? `تجاوز ${timeoutMs} ملي ثانية`
              : reason === "open"
                ? "قاطعُ دائرةِ Redis مفتوحٌ"
                : "حاجزُ تزامنِ Redis ممتلئٌ",
        });
      }
      const response = outcome.value;

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
