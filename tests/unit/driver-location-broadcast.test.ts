/**
 * الغرض: قياسُ حكمِ نبضةِ الموقعِ — **كلُّ فرعٍ بمُعطىً لا بمُهلةٍ حقيقيّةٍ**
 *   (البند `F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ مؤقّتاً ولا مُضيفَ تلغرامَ**: الحكمُ قيمةٌ تُقارَنُ، والغلافُ
 *   يُقاسُ بسلوكِ الشاشةِ لا ههنا.
 * - **لا يقيسُ بطاريّةً ولا صدقَ موضعٍ**: كلاهما غيرُ مقيسٍ ولا يُدَّعى.
 */

import { describe, expect, test } from "bun:test";
import {
  type BroadcastInput,
  backoffMultiplier,
  MAX_BACKOFF_DOUBLINGS,
  nextBroadcastDecision,
} from "../../packages/domain/driver/location-broadcast.ts";

const GRANTED = {
  inited: true,
  available: true,
  accessRequested: true,
  accessGranted: true,
} as const;

function input(patch: Partial<BroadcastInput> = {}): BroadcastInput {
  return {
    policy: { reason: "ON_TRIP", intervalSeconds: 20 },
    nowMs: 1_000_000,
    lastAttemptAtMs: null,
    consecutiveFailures: 0,
    access: GRANTED,
    lastError: null,
    ...patch,
  };
}

describe("السكونُ: سببٌ مُسمّىً لا رمزٌ عامٌّ", () => {
  test("لا سببَ ⇒ توقُّفٌ، ولا يُستَجدى إذنٌ بلا حاجةٍ", () => {
    const verdict = nextBroadcastDecision(
      input({ policy: { reason: null, intervalSeconds: null }, access: null }),
    );
    expect(verdict).toEqual({ kind: "STOP", why: "NO_REASON_TO_BROADCAST" });
  });

  test("سببٌ بلا مُدّةٍ ⇒ سكونٌ مُعلَنٌ لا مُدّةٌ مُخترَعةٌ (فشلٌ مغلقٌ)", () => {
    const verdict = nextBroadcastDecision(
      input({ policy: { reason: "AVAILABLE", intervalSeconds: null } }),
    );
    expect(verdict).toEqual({ kind: "STOP", why: "INTERVAL_NOT_CONFIGURED" });
  });

  test("مُضيفٌ لا يُتيحُ موقعاً ⇒ سببٌ يُميَّزُ عن منعِ الإذنِ", () => {
    const verdict = nextBroadcastDecision(
      input({ access: { ...GRANTED, available: false, accessGranted: false } }),
    );
    expect(verdict).toEqual({ kind: "STOP", why: "LOCATION_UNSUPPORTED" });
  });

  test("إذنٌ غيرُ مُعطىً ⇒ سببُه وحدَه، فيُعرَضُ زرُّ الإعدادِ", () => {
    const verdict = nextBroadcastDecision(input({ access: { ...GRANTED, accessGranted: false } }));
    expect(verdict).toEqual({ kind: "STOP", why: "PERMISSION_NOT_GRANTED" });
  });

  test("جلسةٌ ساقطةٌ ⇒ توقُّفٌ قبلَ كلِّ فحصٍ آخرَ، ولا إعادةَ أبديّةً", () => {
    expect(nextBroadcastDecision(input({ lastError: "SESSION_EXPIRED" }))).toEqual({
      kind: "STOP",
      why: "SESSION_LOST",
    });
  });

  test("مَن ليسَ سائقاً ⇒ سببُه مُميَّزٌ عن سقوطِ الجلسةِ", () => {
    expect(nextBroadcastDecision(input({ lastError: "DRIVER_NOT_REGISTERED" }))).toEqual({
      kind: "STOP",
      why: "NOT_A_DRIVER",
    });
  });
});

describe("البثُّ والانتظارُ", () => {
  test("أوّلُ نبضةٍ فوراً: سائقٌ فتحَ شاشتَه ولهُ سببٌ يبثُّ الآنَ", () => {
    expect(nextBroadcastDecision(input())).toEqual({ kind: "SEND", reason: "ON_TRIP" });
  });

  test("قبلَ حلولِ الوقتِ ⇒ انتظارٌ بالفرقِ نفسِه لا بمُدّةٍ كاملةٍ", () => {
    const verdict = nextBroadcastDecision(
      input({ lastAttemptAtMs: 1_000_000 - 5_000, nowMs: 1_000_000 }),
    );
    expect(verdict).toEqual({ kind: "WAIT", delayMs: 15_000, reason: "ON_TRIP" });
  });

  test("عندَ حلولِ الوقتِ حرفاً ⇒ بثٌّ لا انتظارٌ لِمِلّي ثانيةٍ أُخرى", () => {
    const verdict = nextBroadcastDecision(
      input({ lastAttemptAtMs: 1_000_000 - 20_000, nowMs: 1_000_000 }),
    );
    expect(verdict.kind).toBe("SEND");
  });

  test("ساعةٌ رجعَت إلى الوراءِ ⇒ بثٌّ لا سكونٌ أبديٌّ", () => {
    const verdict = nextBroadcastDecision(
      input({ lastAttemptAtMs: 1_000_000 + 60_000, nowMs: 1_000_000 }),
    );
    expect(verdict.kind).toBe("SEND");
  });
});

describe("التراجعُ: مُضاعَفةٌ بسقفٍ", () => {
  test("بلا فشلٍ ⇒ ضِعفٌ واحدٌ", () => {
    expect(backoffMultiplier(0)).toBe(1);
    expect(backoffMultiplier(-3)).toBe(1);
  });

  test("يُضاعَفُ بعددِ الفشلِ حتّى السقفِ ثمَّ يثبتُ", () => {
    expect(backoffMultiplier(1)).toBe(2);
    expect(backoffMultiplier(MAX_BACKOFF_DOUBLINGS)).toBe(2 ** MAX_BACKOFF_DOUBLINGS);
    expect(backoffMultiplier(MAX_BACKOFF_DOUBLINGS + 40)).toBe(2 ** MAX_BACKOFF_DOUBLINGS);
  });

  test("فشلانِ متتاليانِ يُطيلانِ الانتظارَ أربعةَ أضعافٍ", () => {
    const verdict = nextBroadcastDecision(
      input({ lastAttemptAtMs: 1_000_000, nowMs: 1_000_000, consecutiveFailures: 2 }),
    );
    expect(verdict).toEqual({ kind: "WAIT", delayMs: 80_000, reason: "ON_TRIP" });
  });

  test("سقفُ التراجعِ يمنعُ نبضةً في الساعةِ بعدَ انقطاعٍ طويلٍ", () => {
    const verdict = nextBroadcastDecision(
      input({ lastAttemptAtMs: 1_000_000, nowMs: 1_000_000, consecutiveFailures: 99 }),
    );
    expect(verdict).toEqual({
      kind: "WAIT",
      delayMs: 20_000 * 2 ** MAX_BACKOFF_DOUBLINGS,
      reason: "ON_TRIP",
    });
  });
});
