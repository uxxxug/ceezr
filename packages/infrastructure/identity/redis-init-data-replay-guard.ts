/**
 * الغرض: محوّلُ حارسِ إعادةِ استعمالِ `initData` على Redis — استهلاكٌ ذرّيٌّ لمرةٍ
 *   واحدةٍ بأمرِ `SET key value NX EX ttl` في طلبٍ واحد. لا يُخزَّنُ `initData` الخامُّ
 *   ولا `hash` ولا أيُّ جزءٍ منه — البصمةُ وحدها، وهي هضمٌ لا يُسترجَعُ منه الأصل.
 * الحالة: منفّذ — البند `SEC-17`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقَّع أن يستخدمه لاحقاً: `apps/gateway/src/container.ts` حقناً في مسارِ الجلسة.
 * ملاحظات مستقبلية: لو احتيج تخزينٌ أطولُ من نافذةِ العمرِ لمراجعةٍ تدقيقيّةٍ فذاك
 *   بندٌ مستقلٌّ (`SEC-18` · مخزنُ الجلسات) ولا يُمزَجُ هنا.
 *
 * قواعدُ صارمةٌ في هذا الملف:
 *   ١) لا يُسجَّلُ `initData` الخامُّ ولا البصمةُ ولا مفتاحُ Redis ولا أيُّ جزءٍ منها.
 *   ٢) الفشلُ في الوصولِ إلى Redis **إغلاقٌ لا فتحٌ**: لا تُصدَر جلسةٌ حين يُعجزُ الحارس.
 *   ٣) الأمرُ ذرّيٌّ: `SET NX` يضمنُ أنَّ أوّلَ مستهلكٍ يفوزُ وحدَه، والثاني يُرفَض.
 */

import { createHash } from "node:crypto";
import type { InitDataReplayGuard, ReplayGuardFailure } from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { RedisClient } from "../redis/upstash.ts";

const KEY_PREFIX = "initdata-replay:";

/**
 * يُحسبُ البصمةُ من النصِّ الخامِّ كاملًا — لا من حقلِ `hash` وحده. والسبب: البصمةُ
 * مُستعمَلةٌ لمنعِ إعادةِ النصِّ نفسه، والنصُّ يشملُ كلَّ الحقولِ لا `hash` وحده.
 * و`sha256` كافٍ هنا لأنَّ الغرضَ منعُ التكرارِ لا مقاومةُ تصادمٍ عبرَ الحدود.
 */
function fingerprintOf(rawInitData: string): string {
  return createHash("sha256").update(rawInitData).digest("hex");
}

export function createRedisInitDataReplayGuard(redis: RedisClient): InitDataReplayGuard {
  return {
    async consume(
      rawInitData: string,
      ttlSeconds: number,
    ): Promise<Result<true, ReplayGuardFailure>> {
      const fingerprint = fingerprintOf(rawInitData);
      const key = `${KEY_PREFIX}${fingerprint}`;
      const ttl = Math.max(1, Math.ceil(ttlSeconds));

      // `SET key 1 NX EX ttl` — استهلاكٌ ذرّيٌّ لمرةٍ واحدة. إن كان المفتاحُ موجودًا
      // يردُّ Redis `nil` (لا "OK")، فيُعلَمُ الحارسُ أنَّ البصمةَ استُهلِكَت.
      const result = await redis.command(["SET", key, "1", "NX", "EX", String(ttl)]);

      if (!result.ok) {
        // فشلُ الوصولِ إلى Redis — إغلاقٌ لا فتح.
        return err({
          kind: "STORE_UNAVAILABLE",
          detail: result.error.detail,
        });
      }

      // Upstash يردُّ "OK" عندَ النجاح، و`null` عندَ فشلِ `NX` (المفتاحُ موجود).
      const value = result.value;
      if (value === "OK") {
        return ok(true);
      }

      // المفتاحُ موجودٌ — البصمةُ استُهلِكَت مرّةً سابقةً ضمنَ النافذة.
      return err({
        kind: "REPLAYED",
        detail: "initData fingerprint already consumed within its lifetime window",
      });
    },
  };
}
