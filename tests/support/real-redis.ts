/**
 * الغرض: عميلُ Redis **حقيقيٌّ** للاختبارِ، مقروءٌ من بيئةِ CI وحدَها، بثلاثةِ حروسٍ:
 *   عزلُ المفاتيحِ ببادئةٍ خاصّةٍ بالتشغيلِ، وكتمُ النقطةِ والرمزِ في كلِّ نصٍّ يخرج،
 *   وعدُّ الأوامرِ ليُثبَت أنّ خادماً خُوطِبَ فعلاً.
 * الحالة: منفّذ فعلياً — `OPS-006` (ADR 0049).
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارٍ في `tests/real-redis/`.
 * ملاحظات مستقبلية: لو احتيج `SCAN` بأنماطٍ أوسعَ فيبقى العزلُ بالبادئةِ شرطاً —
 *   `FLUSHDB` ممنوعٌ ههنا عن قصدٍ: القاعدةُ قد تكون مشتركةً مع غيرِ الاختبار.
 *
 * ولماذا لا يُقرأ السرُّ إلّا ههنا؟ لأنّ موضعاً واحداً يُقرأ فيه السرُّ يُراجَع مرّةً
 * واحدةً. وما يخرج من هذا الملفِّ إلى الاختباراتِ عميلٌ **مكتومُ الرسائلِ**: كلُّ
 * تفصيلِ فشلٍ يمرّ على `redactSecrets` قبلَ أن يراه مُشغِّلُ الاختبارات، لأنّ رسالةَ
 * `fetch` المخفقةِ تحمل الرابطَ في كثيرٍ من أزمنةِ التشغيلِ — فتُطبَع النقطةُ في سجلٍّ
 * عامٍّ من حيثُ لا يُقصَد.
 */

import { createUpstashRedis, type RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import { redactSecrets } from "../../scripts/lib/real-redis-proof.ts";

const URL_VAR = "UPSTASH_REDIS_REST_URL";
const TOKEN_VAR = "UPSTASH_REDIS_REST_TOKEN";

/** شرطُ التفعيلِ الصريحُ: حين يُضبَط، غيابُ النقطةِ إخفاقٌ لا تخطٍّ. */
export const REQUIRE_REAL_REDIS_VAR = "REQUIRE_REAL_REDIS";

export interface RealRedisHandle {
  readonly client: RedisClient;
  /** بادئةٌ خاصّةٌ بهذا التشغيلِ — لا تُصادِم تشغيلاً متوازياً ولا استعمالاً آخرَ للقاعدةِ. */
  readonly prefix: string;
  readonly runId: string;
  readonly commandsIssued: () => number;
  /** مفاتيحُ يُنشئها كودُ الإنتاجِ ببادئتِه هو، فتُسجَّل ههنا لتُمحى في النهايةِ. */
  readonly trackForeignKey: (key: string) => void;
  /** يمحو ما أنشأه هذا التشغيلُ ويُعيد عددَ ما بقي — والباقي غيرُ الصفرِ إخفاقٌ. */
  readonly cleanup: () => Promise<number>;
}

export function realRedisConfigured(): boolean {
  const url = process.env[URL_VAR];
  const token = process.env[TOKEN_VAR];
  return typeof url === "string" && url !== "" && typeof token === "string" && token !== "";
}

/**
 * غيابُ النقطةِ مع `REQUIRE_REAL_REDIS=1` **يُسقِط** التشغيلَ: هذه هي الوظيفةُ التي
 * وُجدت لتُشغِّل الاختبارَ على خادمٍ حقيقيٍّ، فتخطّيها صامتةً يُعيد العيبَ الذي
 * وُجد الحاجزُ لأجلِه — خُضرةٌ بلا تجريبٍ.
 */
export function assertRealRedisWhenRequired(): void {
  if (process.env[REQUIRE_REAL_REDIS_VAR] === "1" && !realRedisConfigured()) {
    throw new Error(
      `${REQUIRE_REAL_REDIS_VAR}=1 ولا ${URL_VAR}/${TOKEN_VAR} في البيئةِ — ` +
        `وظيفةٌ وُجدت لتُشغِّل على Redis حقيقيٍّ لا تُقرَأ خضراءَ وهي لم تُخاطِبه.`,
    );
  }
}

/** يُقرأ مرّةً واحدةً، ولا يُعاد إلى المتّصلِ ولا يُكتَب في ملفٍّ ولا في مخرجاتٍ. */
function readSecrets(): { url: string; token: string } {
  const url = process.env[URL_VAR] ?? "";
  const token = process.env[TOKEN_VAR] ?? "";
  if (url === "" || token === "") {
    throw new Error(`لا ${URL_VAR}/${TOKEN_VAR} في البيئةِ — لا يُبنى عميلٌ حقيقيٌّ بلا نقطةٍ.`);
  }
  return { url, token };
}

export function createRealRedis(): RealRedisHandle {
  const { url, token } = readSecrets();
  const secrets = [url, token];
  const inner = createUpstashRedis({ url, token });
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const salt = Math.random().toString(36).slice(2, 10);
  const prefix = `waslah:citest:${runId}:${attempt}:${salt}`;
  const foreign = new Set<string>();
  let issued = 0;

  const client: RedisClient = {
    command: async (args) => {
      issued += 1;
      const result = await inner.command(args);
      if (result.ok) return result;
      return {
        ok: false,
        error: {
          kind: result.error.kind,
          detail: redactSecrets(result.error.detail, secrets),
        },
      };
    },
  };

  const scanPrefix = async (): Promise<string[]> => {
    const found: string[] = [];
    let cursor = "0";
    // حدٌّ للدوراتِ: خادمٌ يردّ مؤشّراً لا ينتهي كان سيُعلِّق الوظيفةَ حتى المهلةِ العامّة.
    for (let round = 0; round < 64; round += 1) {
      const result = await client.command(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", 200]);
      if (!result.ok) break;
      const payload = result.value;
      if (!Array.isArray(payload) || payload.length < 2) break;
      cursor = String(payload[0]);
      const keys = payload[1];
      if (Array.isArray(keys)) for (const key of keys) found.push(String(key));
      if (cursor === "0") break;
    }
    return found;
  };

  return {
    client,
    prefix,
    runId: `${runId}:${attempt}`,
    commandsIssued: () => issued,
    trackForeignKey: (key) => {
      foreign.add(key);
    },
    cleanup: async () => {
      for (const key of [...foreign, ...(await scanPrefix())]) {
        await client.command(["DEL", key]);
      }
      const remaining = await scanPrefix();
      let leftover = remaining.length;
      for (const key of foreign) {
        const check = await client.command(["EXISTS", key]);
        if (check.ok && Number(check.value) === 1) leftover += 1;
      }
      return leftover;
    },
  };
}
