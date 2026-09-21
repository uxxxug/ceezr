/**
 * الغرض: اختبارُ `SEC-17` على مسارِ الجلسةِ الكامل — أنَّ التحقّقَ يحدثُ أوّلاً،
 *   وأنَّ إعادةَ `initData` نفسِها يُرفَضُ، وأنَّ التوقيعَ السيّئَ لا يستهلكُ بصمة.
 * الحالة: اختبار فعلي — مسارُ `exchangeTelegramSession` بحارسِ ذاكرةٍ مزدوج.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type ExchangeTelegramSessionDeps,
  exchangeTelegramSession,
} from "../../packages/application/identity/exchange-telegram-session.ts";
import type {
  InitDataReplayGuard,
  IssuedMiniAppSession,
  MiniAppSessionIssuer,
  TelegramIdentityProof,
  TelegramIdentityVerifier,
} from "../../packages/application/identity/ports.ts";
import { createMemoryInitDataReplayGuard } from "../../packages/infrastructure/identity/memory-init-data-replay-guard.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import {
  buildInitData,
  FAKE_DRIVER_BOT_TOKEN,
  SAMPLE_USER,
} from "../support/telegram-init-data.ts";

const NOW = new Date("2027-01-15T10:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const VERIFIER: TelegramIdentityVerifier = createTelegramInitDataVerifier({
  bots: [{ name: "driver", token: FAKE_DRIVER_BOT_TOKEN }],
});

const STUB_ISSUER: MiniAppSessionIssuer = {
  issue(
    proof: TelegramIdentityProof,
    nowMs: number,
  ): Result<
    IssuedMiniAppSession,
    { code: "SESSION_ISSUE_FAILED"; reason: "NOT_CONFIGURED" | "ISSUER_ERROR" }
  > {
    return ok({
      accessToken: `stub-token-for-${proof.telegramUserId}-${nowMs}`,
      expiresAtMs: nowMs + 600_000,
      expiresInSeconds: 600,
      tokenType: "Bearer",
    });
  },
};

function buildDeps(
  replayGuard: InitDataReplayGuard,
  issuedFor: TelegramIdentityProof[],
): ExchangeTelegramSessionDeps {
  const spyIssuer: MiniAppSessionIssuer = {
    issue(proof, nowMs) {
      issuedFor.push(proof);
      return STUB_ISSUER.issue(proof, nowMs);
    },
  };
  return {
    verifier: VERIFIER,
    issuer: spyIssuer,
    replayGuard,
    now: () => NOW,
    log: () => {},
  };
}

function validInitData(): string {
  return buildInitData({
    botToken: FAKE_DRIVER_BOT_TOKEN,
    authDateSeconds: NOW_SECONDS - 10,
    user: SAMPLE_USER,
    queryId: "AAH-replay-test",
  });
}

describe("SEC-17 — حارسُ إعادةِ initData في مسارِ الجلسة", () => {
  it("أوّلُ تبادلٍ ينجح، والثاني بنفسِ initData يُرفَضُ بـINIT_DATA_REJECTED", async () => {
    const guard = createMemoryInitDataReplayGuard(() => NOW);
    const issuedFor: TelegramIdentityProof[] = [];
    const deps = buildDeps(guard, issuedFor);

    const initData = validInitData();
    const first = await exchangeTelegramSession({ initData }, deps);
    expect(first.ok).toBe(true);

    const second = await exchangeTelegramSession({ initData }, deps);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("توقّعنا رفضًا");
    expect(second.error.code).toBe("INIT_DATA_REPLAYED");
    expect(second.error.publicCode).toBe("INIT_DATA_REJECTED");

    // المُصدِر استُدعي مرّةً واحدةً فقط — الرفضُ الثاني لم يصل إليه.
    expect(issuedFor.length).toBe(1);
  });

  it("توقيعٌ سيّئٌ لا يستهلكُ البصمة — التحقّقُ قبلَ الحارس", async () => {
    const guard = createMemoryInitDataReplayGuard(() => NOW);
    const issuedFor: TelegramIdentityProof[] = [];
    const deps = buildDeps(guard, issuedFor);

    const badInitData = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 10,
      user: SAMPLE_USER,
      queryId: "AAH-bad-sig",
      overrideHash: "e".repeat(64),
    });

    const bad = await exchangeTelegramSession({ initData: badInitData }, deps);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("توقّعنا رفضًا");
    expect(bad.error.code).toBe("TELEGRAM_PROOF_REJECTED");

    // البصمةُ لم تُستهلَك — فالنصُّ الصحيحُ بنفسِ البنيةِ يُقبَلُ بعدها.
    const goodInitData = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 10,
      user: SAMPLE_USER,
      queryId: "AAH-bad-sig",
    });
    const good = await exchangeTelegramSession({ initData: goodInitData }, deps);
    expect(good.ok).toBe(true);
    expect(issuedFor.length).toBe(1);
  });

  it("initData منتهيةُ العمرِ لا تستهلكُ البصمة — تُرفَضُ قبلَ الحارس", async () => {
    const guard = createMemoryInitDataReplayGuard(() => NOW);
    const issuedFor: TelegramIdentityProof[] = [];
    const deps = buildDeps(guard, issuedFor);

    const staleInitData = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 3600,
      user: SAMPLE_USER,
      queryId: "AAH-stale",
    });

    const stale = await exchangeTelegramSession({ initData: staleInitData }, deps);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("توقّعنا رفضًا");
    expect(stale.error.code).toBe("TELEGRAM_PROOF_REJECTED");

    // البصمةُ لم تُستهلَك — فالنصُّ الصحيحُ يُقبَلُ بعدها.
    const fresh = await exchangeTelegramSession({ initData: validInitData() }, deps);
    expect(fresh.ok).toBe(true);
    expect(issuedFor.length).toBe(1);
  });

  it("عجزُ الحارسِ يُغلقُ المسار — لا تُصدَر جلسةٌ عند فشلِ المخزن", async () => {
    const failingGuard: InitDataReplayGuard = {
      async consume(): Promise<
        Result<true, { kind: "REPLAYED" | "STORE_UNAVAILABLE"; detail: string }>
      > {
        return err({ kind: "STORE_UNAVAILABLE", detail: "mock failure" });
      },
    };
    const issuedFor: TelegramIdentityProof[] = [];
    const deps = buildDeps(failingGuard, issuedFor);

    const result = await exchangeTelegramSession({ initData: validInitData() }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("توقّعنا رفضًا");
    expect(result.error.code).toBe("REPLAY_GUARD_UNAVAILABLE");
    expect(result.error.publicCode).toBe("SESSION_NOT_AVAILABLE");
    expect(issuedFor.length).toBe(0);
  });
});
