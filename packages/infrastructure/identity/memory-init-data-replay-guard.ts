/**
 * الغرض: محوّلُ حارسِ إعادةِ استعمالِ `initData` في الذاكرة — للاختبارِ وللنشرِ
 *   أحاديِّ المثيل. نفسُ عقدِ `InitDataReplayGuard`، ونفسُ ضمانِ الاستهلاكِ لمرةٍ
 *   واحدة، بلا شبكةٍ ولا Redis.
 * الحالة: منفّذ — البند `SEC-17` (مزدوجُ اختبارٍ وقابلٌ للنشرِ الأحادي).
 * ينتمي إلى: infrastructure/identity
 *
 * قواعدُ صارمةٌ: لا يُسجَّلُ `initData` الخامُّ ولا البصمةُ. والاستهلاكُ ذرّيٌّ
 * بمعنى المفرد: إن كان المفتاحُ موجودًا ولم ينتهِ عمرُه بعدُ، يُرفَضُ الثاني.
 */

import { createHash } from "node:crypto";
import type { InitDataReplayGuard, ReplayGuardFailure } from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

const KEY_PREFIX = "initdata-replay:";

function fingerprintOf(rawInitData: string): string {
  return createHash("sha256").update(rawInitData).digest("hex");
}

interface Entry {
  readonly expiresAtMs: number;
}

/**
 * محوّلُ ذاكرةٍ — يُنظَّفُ بالكسلِ عندَ كلِّ استهلاك. مناسبٌ للاختبارِ وللنشرِ
 * الأحادي؛ **ولا يُدَّعى أنه يعملُ عبرَ مثيلاتٍ متعدّدة** — ذاككَ Redis.
 */
export function createMemoryInitDataReplayGuard(
  now: () => Date = () => new Date(),
): InitDataReplayGuard {
  const store = new Map<string, Entry>();

  return {
    async consume(
      rawInitData: string,
      ttlSeconds: number,
    ): Promise<Result<true, ReplayGuardFailure>> {
      const fingerprint = fingerprintOf(rawInitData);
      const key = `${KEY_PREFIX}${fingerprint}`;
      const nowMs = now().getTime();

      // تنظيفٌ كسولٌ: احذف ما انتهى عمرُه قبلَ الفحص.
      for (const [k, entry] of store) {
        if (entry.expiresAtMs <= nowMs) {
          store.delete(k);
        }
      }

      const existing = store.get(key);
      if (existing !== undefined && existing.expiresAtMs > nowMs) {
        return err({
          kind: "REPLAYED",
          detail: "initData fingerprint already consumed within its lifetime window",
        });
      }

      store.set(key, { expiresAtMs: nowMs + ttlSeconds * 1000 });
      return ok(true);
    },
  };
}
