/**
 * الغرض: محوّلٌ صغيرٌ من واجهةِ Upstash REST إلى خادمِ Redis حقيقيٍّ — يُمكّنُ
 *   اختبارَ الفوضى متعدّدَ المثيلاتِ (F5-06) من تشغيلِ البوابةِ ضدّ Redis حقيقيٍّ
 *   دون تغييرِ مسارِ العميلِ الإنتاجيِّ (packages/infrastructure/redis/upstash.ts)
 *   الذي يتحدّثُ واجهةَ Upstash REST وحدها.
 *
 *   وليس هذا بديلًا إنتاجيًّا ولا يُستعمَلُ إلّا في اختبارِ CI. البوابةُ تُشغَّلُ
 *   بـ`TELEGRAM_TRANSPORT=silent` و`SESSION_STORE=redis` و`PROCESS_TOPOLOGY=
 *   multi-process`، وتُشيرُ إلى هذا المحوّلِ عبرَ `UPSTASH_REDIS_REST_URL`.
 *
 * المبدأ: تمريرٌ عامٌّ لا ترميزٌ يدويٌّ. كلُّ مصفوفةِ أمرٍ تُمرَّرُ كما هي إلى
 *   Redis عبرَ `redis.call(...args)`، ويُعادُ الناتجُ بصيغةِ Upstash:
 *   `{"result": <value>}` عند النجاح، أو `{"error": "<message>"}` عند فشلِ الأمرِ
 *   نفسِه (لا فشلِ الشبكة). والفصلُ بين النوعَينِ هو عينُ ما يفصلُه `upstash.ts`
 *   في `kind: "redis"` مقابل `kind: "network"`.
 *
 * ينتمي إلى: docker/upstash-rest-shim
 * يُتوقَّعُ أن يستخدمه: docker-compose.f5-06.yml + وظيفةُ CI `chaos-multi-instance`.
 */

import { serve } from "bun";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
const PORT = Number(process.env.PORT ?? 8081);
const SHIM_TOKEN = process.env.SHIM_TOKEN ?? "shim-token";

/** عميلٌ واحدٌ مشتركٌ — الاتصالُ يُعادُ تلقائيًّا بواسطةِ ioredis. */
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("error", (error) => {
  console.error("[upstash-shim] redis error:", error.message);
});

/** يطابقُ ما ينتظرُه `upstash.ts`: جسمٌ فيه `result` أو `error` نصًّا. */
function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(message: string, status = 200): Response {
  // Upstash يُعيدُ خطأَ الأمرِ بـHTTP 200 وجسمٍ فيه `error` — لا بـ4xx/5xx.
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** يتحقّقُ من سرِّ الحاملِ كما يفعلُ Upstash. */
function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${SHIM_TOKEN}`;
}

await serve({
  port: PORT,
  fetch: async (request) => {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    if (!authorized(request)) {
      return new Response("unauthorized", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch (error) {
      return errorResponse(`invalid JSON body: ${(error as Error).message}`);
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return errorResponse("command must be a non-empty array");
    }

    // أوامرُ Upstash تأتي كمصفوفةِ نصوصٍ (مع أرقامٍ أحيانًا). ioredis يتوقّعُ
    // وسائطَ منفصلةً، فيُمرَّرُ الأمرُ بالانتشارِ لا كمصفوفة.
    const args = payload.map(String);

    try {
      const reply = await redis.call(...(args as [string, ...string[]]));
      // null في Redis ⇐ غيابُ المفتاحِ — يُعادُ كما هو لا "undefined".
      return jsonResponse(reply ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[upstash-shim] command failed: ${args.join(" ")} -> ${message}`);
      return errorResponse(message);
    }
  },
});

console.log(`[upstash-shim] listening on :${PORT} -> ${REDIS_URL}`);
