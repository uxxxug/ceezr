/**
 * سالباتٌ مبذورةٌ لحَكَمِ `F11-02` (`ح-7`): كلُّ قاعدةٍ تسقطُ على لقطةٍ فاسدةٍ واحدةٍ، واللقطةُ
 * السليمةُ تمرُّ — فخضرةُ الاختبارِ الحقيقيِّ لا تكونُ حَكَماً أعمى.
 */
import { describe, expect, it } from "bun:test";
import {
  judgeWorkerLoss,
  type WorkerLossSnapshot,
} from "../../scripts/lib/worker-loss-invariants.ts";

const HEALTHY: WorkerLossSnapshot = {
  advisoryLocksAfterKill: 0,
  rows: [{ status: "delivered", attempts: 2, messageId: "m-2", claimToken: "t-b" }],
  deadClaimToken: "t-a",
  lateFinishAccepted: false,
  messageIdAfterLateFinish: "m-2",
  sends: 2,
  sendBound: 2,
  offers: 1,
};

const row = HEALTHY.rows[0] ?? { status: "", attempts: 0, messageId: null, claimToken: null };

const SEEDED: readonly [string, Partial<WorkerLossSnapshot>][] = [
  ["lock.survived_process_death", { advisoryLocksAfterKill: 1 }],
  ["outbox.row_count", { rows: [row, row] }],
  ["outbox.not_delivered", { rows: [{ ...row, status: "sending" }] }],
  ["outbox.no_message_id", { rows: [{ ...row, messageId: null }], messageIdAfterLateFinish: null }],
  ["outbox.reclaim_not_counted", { rows: [{ ...row, attempts: 1 }] }],
  ["outbox.dead_token_still_owns", { rows: [{ ...row, claimToken: "t-a" }] }],
  ["finish.dead_token_accepted", { lateFinishAccepted: true }],
  ["finish.dead_token_overwrote", { messageIdAfterLateFinish: "ghost" }],
  ["send.lost", { sends: 0 }],
  ["send.beyond_bound", { sends: 3 }],
  ["offer.duplicated", { offers: 2 }],
];

describe("حَكَمُ فقدانِ العاملِ — F11-02", () => {
  it("اللقطةُ السليمةُ تمرُّ بلا مخالفةٍ", () => {
    expect(judgeWorkerLoss(HEALTHY)).toEqual({ ok: true, violations: [] });
  });

  for (const [rule, patch] of SEEDED) {
    it(`لقطةٌ فاسدةٌ تُسقِطُ ${rule}`, () => {
      const verdict = judgeWorkerLoss({ ...HEALTHY, ...patch });
      expect(verdict.ok).toBe(false);
      expect(verdict.violations).toContain(rule);
    });
  }

  it("إرسالٌ ثانٍ في طورِ «قبلَ الإرسالِ» خرقٌ: الحدُّ فيه واحدٌ", () => {
    expect(judgeWorkerLoss({ ...HEALTHY, sendBound: 1 }).violations).toEqual(["send.beyond_bound"]);
  });
});
