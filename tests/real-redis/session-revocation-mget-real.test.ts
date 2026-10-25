/**
 * الغرض: `LOAD-01` — فحصُ الإبطالِ في رحلةٍ واحدةٍ (`MGET`) على **Redis حقيقيٍّ** عبرَ قشرةِ
 *   REST نفسِها: الأمرُ يُقبَلُ ويُعادُ بشكلِه المتوقَّعِ (مصفوفةٌ بقيمتَين بترتيبِ المفاتيح)،
 *   والحكمُ في كلِّ حالةٍ هوَ حكمُ الفحصَين المتتابعَين (`GET` ثمَّ `GET`) حرفاً، بأمرٍ واحدٍ
 *   مقابلَ أمرَين. لا يُثبِتُ ذلك مزدوجٌ: شكلُ ردِّ `MGET` من الخادمِ والقشرةِ هوَ المقيس.
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّب `UPSTASH_REDIS_REST_URL`/`_TOKEN`.
 * ينتمي إلى: tests/real-redis
 * يُتوقَّع أن يستخدمه لاحقاً: وظيفةُ «تكامل على Redis حقيقي» في CI (ADR 0193).
 * ملاحظات مستقبلية: لا شيء.
 */

import { describe, expect, it } from "bun:test";
import type {
  MiniAppSessionReader,
  SessionRevocationStore,
  VerifiedViewerSession,
} from "../../packages/application/identity/ports.ts";
import { createRedisSessionRevocationStore } from "../../packages/infrastructure/identity/redis-session-revocation-store.ts";
import { createRevocableSessionReader } from "../../packages/infrastructure/identity/revocable-session-reader.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  assertRealRedisWhenRequired,
  createRealRedis,
  realRedisConfigured,
} from "../support/real-redis.ts";

assertRealRedisWhenRequired();

/** شرطُ التفعيلِ بأسماءِ المتغيّراتِ صريحةً كي يطابقَه حاجزُ تصنيفِ التجاوزِ (`OPS-009`). */
const ENABLED =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured();

const suite = ENABLED ? describe : describe.skip;
const ISSUED_AT_SECONDS = 1_800_000_000;

function sequentialOnly(store: SessionRevocationStore): SessionRevocationStore {
  const { checkSession: _dropped, ...rest } = store;
  return rest;
}

suite("LOAD-01 — فحصُ الإبطالِ بأمرِ MGET واحدٍ على Redis حقيقيّ", () => {
  it("حكمُ MGET = حكمُ GET ثمَّ GET في كلِّ حالةٍ، بأمرٍ واحدٍ مقابلَ أمرَين", async () => {
    const scope = createRealRedis();
    const store = createRedisSessionRevocationStore(scope.client);
    // مفاتيحُ المخزنِ ببادئتِه هو؛ فالمعرّفاتُ تحملُ بادئةَ التشغيلِ وتُسجَّلُ لتُمحى.
    const tag = scope.prefix.replaceAll(":", "-");
    const cases = [
      { name: "سليمة", jti: `${tag}-ok`, user: `${tag}-u1`, revokeJti: false, epoch: null },
      { name: "مُبطَلة", jti: `${tag}-rv`, user: `${tag}-u2`, revokeJti: true, epoch: null },
      {
        name: "عتبةٌ لاحقة",
        jti: `${tag}-ep`,
        user: `${tag}-u3`,
        revokeJti: false,
        epoch: ISSUED_AT_SECONDS * 1000 + 1,
      },
      {
        name: "عتبةٌ سابقة",
        jti: `${tag}-old`,
        user: `${tag}-u4`,
        revokeJti: false,
        epoch: ISSUED_AT_SECONDS * 1000 - 1,
      },
    ] as const;

    for (const c of cases) {
      scope.trackForeignKey(`revoked-session:${c.jti}`);
      scope.trackForeignKey(`revoked-user:${c.user}`);
      if (c.revokeJti) expect((await store.revoke(c.jti, 60, "test")).ok).toBe(true);
      if (c.epoch !== null) {
        expect((await store.revokeAllForUser(c.user, c.epoch, 60, "test")).ok).toBe(true);
      }
      const session = {
        telegramUserId: c.user,
        bot: "rider",
        sessionId: c.jti,
        issuedAtSeconds: ISSUED_AT_SECONDS,
      } as VerifiedViewerSession;
      const inner = {
        read: async () => ok(session),
        readSync: () => ok(session),
      } as unknown as MiniAppSessionReader;

      const before = scope.commandsIssued();
      const viaMget = await createRevocableSessionReader(inner, store).read("t", 0);
      const mgetCommands = scope.commandsIssued() - before;
      const mid = scope.commandsIssued();
      const viaGets = await createRevocableSessionReader(inner, sequentialOnly(store)).read("t", 0);
      const getCommands = scope.commandsIssued() - mid;

      expect(viaMget).toEqual(viaGets);
      expect(mgetCommands).toBe(1);
      expect(getCommands).toBe(c.revokeJti ? 1 : 2);
      expect(viaMget.ok).toBe(c.name === "سليمة" || c.name === "عتبةٌ سابقة");
    }

    // شكلُ الردِّ الخامِ من الخادمِ: مصفوفةٌ بقيمتَين بترتيبِ المفاتيح.
    const raw = await scope.client.command([
      "MGET",
      `revoked-session:${cases[1].jti}`,
      `revoked-user:${cases[2].user}`,
    ]);
    expect(raw).toEqual({ ok: true, value: ["1", String(ISSUED_AT_SECONDS * 1000 + 1)] });

    // التنظيفُ ههنا لا في `afterAll` (انظر `rate-limit-routes-real.test.ts`).
    expect(await scope.cleanup()).toBe(0);
  });
});
