/**
 * الغرض: سالباتُ `judgeBrownout` المبذورةُ (`F11-04` · `ح-7`) — كلُّ قاعدةٍ تسقطُ بخرقِها وحدَه،
 *   ولقطةٌ مقيسةٌ فعلاً (بمهلةِ 1000ms) تمرُّ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { createSql } from "../../packages/infrastructure/db/client.ts";
import { type BrownoutSnapshot, judgeBrownout } from "../../scripts/lib/brownout-invariants.ts";

/** اللقطةُ المقيسةُ محلّيّاً في `tests/integration/pg-brownout.test.ts` (بمهلةِ 1000ms). */
const SOUND: BrownoutSnapshot = {
  deadlineMs: 1_000,
  brownoutMs: 4_000,
  blocked: { total: 10, cancelled: 10, succeeded: 0, otherErrors: 0, maxSettleMs: 1_013 },
  unrelated: { ok: true, latencyMs: 807 },
  serverWaitersAfterDeadline: 0,
  deadlineHookCalls: 10,
  recovery: { ok: true, latencyMs: 3 },
  idleInTransaction: 0,
};

/** اللقطةُ المقيسةُ بلا مهلةٍ — الحالُ قبلَ `F11-04`. */
const CASCADE: BrownoutSnapshot = {
  deadlineMs: null,
  brownoutMs: 4_000,
  blocked: { total: 10, cancelled: 0, succeeded: 10, otherErrors: 0, maxSettleMs: 4_005 },
  unrelated: { ok: true, latencyMs: 3_805 },
  serverWaitersAfterDeadline: 5,
  deadlineHookCalls: 0,
  recovery: { ok: true, latencyMs: 0 },
  idleInTransaction: 0,
};

const only = (patch: Partial<BrownoutSnapshot>): readonly string[] =>
  judgeBrownout({ ...SOUND, ...patch }).violations;

describe("حَكَمُ بطءِ PostgreSQL — F11-04", () => {
  it("اللقطةُ المقيسةُ بمهلةٍ ⇒ قبولٌ", () => {
    expect(judgeBrownout(SOUND)).toEqual({ ok: true, violations: [] });
  });

  it("اللقطةُ المقيسةُ بلا مهلةٍ ⇒ انهيارٌ متتالٍ مُدانٌ", () => {
    expect(judgeBrownout(CASCADE).violations).toEqual([
      "unrelated.cascaded",
      "deadline.absent",
      "server.still_waiting",
    ]);
  });

  it("مسارٌ غيرُ معنيٍّ لم يُخدَم ⇒ سقوطٌ", () => {
    expect(only({ unrelated: { ok: false, latencyMs: 807 } })).toEqual(["unrelated.not_served"]);
  });

  it("مسارٌ غيرُ معنيٍّ تجاوزَ المهلةَ دونَ أن ينتظرَ البطءَ كلَّه ⇒ سقوطٌ", () => {
    expect(only({ unrelated: { ok: true, latencyMs: 2_000 } })).toEqual([
      "unrelated.beyond_deadline",
    ]);
  });

  it("عالقٌ استقرَّ بعدَ المهلةِ ⇒ سقوطٌ", () => {
    expect(only({ blocked: { ...SOUND.blocked, maxSettleMs: 2_500 } })).toEqual([
      "blocked.beyond_deadline",
    ]);
  });

  it("لا إلغاءَ واحدٌ ⇒ البطءُ غيرُ مرصودٍ", () => {
    expect(
      only({ blocked: { ...SOUND.blocked, cancelled: 0, otherErrors: 10 }, deadlineHookCalls: 0 }),
    ).toEqual(["blocked.not_observed", "blocked.wrong_error"]);
  });

  it("عالقٌ نجحَ أي انتظرَ البطءَ ⇒ سقوطٌ", () => {
    expect(
      only({ blocked: { ...SOUND.blocked, cancelled: 9, succeeded: 1 }, deadlineHookCalls: 9 }),
    ).toEqual(["blocked.waited_out_brownout"]);
  });

  it("خطّافُ الرصدِ لا يطابقُ الإلغاءاتِ ⇒ سقوطٌ", () => {
    expect(only({ deadlineHookCalls: 3 })).toEqual(["hook.miscounted"]);
  });

  it("عالقٌ لم يستقرَّ ⇒ سقوطٌ", () => {
    expect(only({ blocked: { ...SOUND.blocked, total: 11 } })).toEqual(["blocked.unsettled"]);
  });

  /** مؤقِّتٌ يرفضُ الوعدَ ولا يُلغي على الخادمِ — أخضرُ على العميلِ وكاذبٌ. */
  it("منتظِرو قفلٍ على الخادمِ بعدَ المهلةِ ⇒ سقوطٌ", () => {
    expect(only({ serverWaitersAfterDeadline: 5 })).toEqual(["server.still_waiting"]);
  });

  it("تعافٍ فاشلٌ أو بطيءٌ ⇒ سقوطٌ", () => {
    expect(only({ recovery: { ok: false, latencyMs: 3 } })).toEqual(["recovery.failed"]);
    expect(only({ recovery: { ok: true, latencyMs: 2_000 } })).toEqual(["recovery.failed"]);
  });

  it("معاملةٌ متروكةٌ مفتوحةً بعدَ الإلغاءِ ⇒ سقوطٌ", () => {
    expect(only({ idleInTransaction: 1 })).toEqual(["tx.left_open"]);
  });
});

describe("createSql · مهلةُ الاستعلامِ — F11-04", () => {
  it("مهلةٌ غيرُ صحيحةٍ ⇒ رفضٌ عندَ الإنشاءِ لا مهلةٌ صامتةٌ", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        createSql({ connectionString: "postgres://x@127.0.0.1:1/x", queryDeadlineMs: bad }),
      ).toThrow("queryDeadlineMs");
    }
  });
});
