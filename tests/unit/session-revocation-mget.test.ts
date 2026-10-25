/**
 * الغرض: `LOAD-01` — فحصُ الإبطالِ (`SEC-18` · `SEC-18-ب`) في **رحلةٍ واحدةٍ** إلى Redis
 *   (`MGET`) يُعطي **الحكمَ نفسَه** الذي يُعطيه الفحصانِ المتتابعانِ (`GET` ثمَّ `GET`) في كلِّ
 *   حالةٍ: جلسةٌ مُبطَلةٌ أو لا × عتبةٌ غائبةٌ أو قبلَ الإصدارِ أو بعدَه أو في المللي ثانيةِ
 *   نفسِها أو لا تُقرَأ × مخزنٌ متاحٌ أو منقطع. والسوالب: ردٌّ لا يُفهَمُ شكلُه = إغلاق.
 * الحالة: اختبار فعلي — بلا شبكة؛ وعلى Redis حقيقيٍّ في
 *   `tests/real-redis/session-revocation-mget-real.test.ts`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
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
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import type { RedisClient } from "../../packages/infrastructure/redis/upstash.ts";
import { ok } from "../../packages/shared/result/index.ts";

const ISSUED_AT_SECONDS = 1_800_000_000;
const SESSION: VerifiedViewerSession = {
  telegramUserId: "424242",
  bot: "rider",
  sessionId: "jti-abc",
  issuedAtSeconds: ISSUED_AT_SECONDS,
} as VerifiedViewerSession;

const inner: MiniAppSessionReader = {
  read: async () => ok(SESSION),
  readSync: () => ok(SESSION),
} as unknown as MiniAppSessionReader;

/** Redis مزدوجٌ يعرفُ `GET` و`MGET` و`SET` على خريطةٍ واحدةٍ، ويعدُّ أوامرَه. */
function fakeRedis(
  entries: Map<string, string>,
  options: { readonly down?: boolean; readonly mgetReply?: unknown } = {},
) {
  const issued: string[] = [];
  const client: RedisClient = {
    command: async (args) => {
      const name = String(args[0]);
      issued.push(name);
      if (options.down === true) return { ok: false, error: { kind: "network", detail: "down" } };
      if (name === "GET") return ok(entries.get(String(args[1])) ?? null);
      if (name === "MGET") {
        if ("mgetReply" in options) return ok(options.mgetReply);
        return ok(args.slice(1).map((key) => entries.get(String(key)) ?? null));
      }
      if (name === "SET") {
        entries.set(String(args[1]), String(args[2]));
        return ok("OK");
      }
      return ok(null);
    },
  } as RedisClient;
  return { client, issued };
}

/** المخزنُ نفسُه بلا `checkSession` — أي المسارُ المتتابعُ كما كانَ قبلَ هذا التغيير. */
function sequentialOnly(store: SessionRevocationStore): SessionRevocationStore {
  const { checkSession: _dropped, ...rest } = store;
  return rest;
}

const EPOCHS: ReadonlyArray<readonly [string, string | undefined]> = [
  ["لا عتبة", undefined],
  ["عتبةٌ قبلَ الإصدار", String(ISSUED_AT_SECONDS * 1000 - 1)],
  ["عتبةٌ في لحظةِ الإصدارِ نفسِها", String(ISSUED_AT_SECONDS * 1000)],
  ["عتبةٌ بعدَ الإصدار", String(ISSUED_AT_SECONDS * 1000 + 1)],
  ["عتبةٌ لا تُقرَأ", "not-a-number"],
];

describe("LOAD-01 — فحصُ الإبطالِ في رحلةٍ واحدةٍ (MGET)", () => {
  for (const sessionRevoked of [false, true]) {
    for (const [label, epoch] of EPOCHS) {
      for (const down of [false, true]) {
        it(`الحكمُ نفسُه: جلسةٌ ${sessionRevoked ? "مُبطَلة" : "سليمة"} · ${label} · المخزنُ ${down ? "منقطع" : "متاح"}`, async () => {
          const entries = new Map<string, string>();
          if (sessionRevoked) entries.set(`revoked-session:${SESSION.sessionId}`, "1");
          if (epoch !== undefined) entries.set(`revoked-user:${SESSION.telegramUserId}`, epoch);

          const single = fakeRedis(new Map(entries), { down });
          const sequential = fakeRedis(new Map(entries), { down });
          const viaMget = await createRevocableSessionReader(
            inner,
            createRedisSessionRevocationStore(single.client),
          ).read("token", 0);
          const viaGets = await createRevocableSessionReader(
            inner,
            sequentialOnly(createRedisSessionRevocationStore(sequential.client)),
          ).read("token", 0);

          expect(viaMget).toEqual(viaGets);
          expect(single.issued).toEqual(["MGET"]);
          expect(sequential.issued.every((name) => name === "GET")).toBe(true);
        });
      }
    }
  }

  it("قيمٌ مطلقةٌ لا تكافؤٌ وحدَه: السليمةُ تُقبَل، والعتبةُ اللاحقةُ والجلسةُ المُبطَلةُ تُرفَضانِ REVOKED", async () => {
    const read = async (entries: Map<string, string>) =>
      createRevocableSessionReader(
        inner,
        createRedisSessionRevocationStore(fakeRedis(entries).client),
      ).read("token", 0);
    expect(await read(new Map())).toEqual(ok(SESSION));
    expect(
      await read(new Map([[`revoked-user:424242`, String(ISSUED_AT_SECONDS * 1000 + 1)]])),
    ).toEqual({ ok: false, error: { code: "SESSION_REJECTED", reason: "REVOKED" } });
    expect(await read(new Map([[`revoked-session:jti-abc`, "1"]]))).toEqual({
      ok: false,
      error: { code: "SESSION_REJECTED", reason: "REVOKED" },
    });
  });

  for (const [label, reply] of [
    ["ليسَ مصفوفة", "1"],
    ["مصفوفةٌ بعنصرٍ واحد", [null]],
    ["مصفوفةٌ بثلاثةِ عناصر", [null, null, null]],
    ["لا شيء", null],
  ] as const) {
    it(`سالبٌ: ردُّ MGET ${label} = إغلاقٌ لا قبول`, async () => {
      const store = createRedisSessionRevocationStore(
        fakeRedis(new Map(), { mgetReply: reply }).client,
      );
      expect(await createRevocableSessionReader(inner, store).read("token", 0)).toEqual({
        ok: false,
        error: { code: "SESSION_REJECTED", reason: "NOT_CONFIGURED" },
      });
    });
  }

  it("مخزنُ الذاكرةِ بلا `checkSession` يبقى على الفحصَين المتتابعَين ويُبطِلُ كما كان", async () => {
    const store = createMemorySessionRevocationStore();
    expect(store.checkSession).toBeUndefined();
    await store.revokeAllForUser(SESSION.telegramUserId, ISSUED_AT_SECONDS * 1000 + 1, 60, "test");
    expect(await createRevocableSessionReader(inner, store).read("token", 0)).toEqual({
      ok: false,
      error: { code: "SESSION_REJECTED", reason: "REVOKED" },
    });
  });
});
