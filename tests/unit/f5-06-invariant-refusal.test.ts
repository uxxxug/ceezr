/**
 * الغرض: مُحاكمةُ حكمِ «رفضِ الإقلاعِ متعدّدِ المثيلاتِ» — أنَّ برهانَ `F5-06` القائمَ
 *   اليومَ يسقطُ إن أقلعَت بوّابةٌ، أو خرجَت بصفرٍ، أو سقطَت لسببٍ آخرَ يُخفي الحاجزَ.
 * الحالة: منفَّذٌ.
 * ينتمي إلى: tests/unit
 * لماذا: Docker غيرُ متاحٍ خارجَ CI، فيُقاسُ المنطقُ محلّيّاً ويبقى الرفعُ لـCI.
 */

import { describe, expect, test } from "bun:test";
import {
  DECIDED_EVENT_DISTRIBUTION,
  distributionCrossesProcessBoundary,
} from "../../packages/shared/config/single-instance.ts";
import { rideIsUnlockable } from "../../scripts/f5-06-chaos.ts";
import {
  analyseRefusal,
  INVARIANT_CODE,
  parseComposePs,
  REFUSAL_SERVICES,
  type ServiceObservation,
} from "../../scripts/f5-06-invariant-refusal.ts";

const refused = (service: string): ServiceObservation => ({
  service,
  exitCode: 1,
  logs: `❌ تعذّر إقلاع البوابة:\n   [${INVARIANT_CODE}] خرقُ شرطِ صحّةِ النسخةِ الواحدةِ`,
});

const allRefused = (): ServiceObservation[] => REFUSAL_SERVICES.map((service) => refused(service));

describe("برهانُ رفضِ الإقلاعِ متعدّدِ المثيلاتِ (F5-06 · R-17)", () => {
  test("ثلاثُ بوّاباتٍ رفضَت برمزِ الخرقِ ⇒ لا مخالفةَ", () => {
    expect(analyseRefusal(allRefused())).toEqual([]);
  });

  test("بوّابةٌ لم تخرج ⇒ الإقلاعُ لم يُرفَض", () => {
    const observations = allRefused();
    observations[1] = { service: "gateway-2", exitCode: null, logs: "server listening" };
    expect(analyseRefusal(observations)).toEqual([
      {
        code: "BOOTED_INSTEAD_OF_REFUSING",
        service: "gateway-2",
        detail: "الحاويةُ لم تخرج: الإقلاعُ لم يُرفَض وشرطُ الصحّةِ لم يُنفَّذ",
      },
    ]);
  });

  test("خروجٌ بصفرٍ ⇒ خروجٌ لا رفضٌ", () => {
    const observations = allRefused();
    observations[0] = { service: "gateway-1", exitCode: 0, logs: "bye" };
    expect(analyseRefusal(observations).map((finding) => finding.code)).toEqual(["EXITED_ZERO"]);
  });

  test("سقوطٌ لسببٍ آخرَ بلا رمزِ الخرقِ ⇒ مخالفةٌ لأنَّه يُخفي الحاجزَ", () => {
    const observations = allRefused();
    observations[2] = {
      service: "gateway-3",
      exitCode: 1,
      logs: "InvalidEnvVarError: SUPABASE_URL",
    };
    expect(analyseRefusal(observations).map((finding) => finding.code)).toEqual([
      "INVARIANT_CODE_ABSENT",
    ]);
  });

  test("خدمةٌ غائبةٌ لا يُحكَمُ لها برفضٍ لم يُشاهَد", () => {
    expect(analyseRefusal([refused("gateway-1")]).map((finding) => finding.service)).toEqual([
      "gateway-2",
      "gateway-3",
    ]);
  });

  test("قراءةُ `compose ps` بسطرٍ لكلِّ خدمةٍ وبمصفوفةٍ واحدةٍ سواءٌ", () => {
    const lines =
      '{"Service":"gateway-1","State":"exited","ExitCode":1}\n{"Service":"gateway-2","State":"exited","ExitCode":1}';
    const array =
      '[{"Service":"gateway-1","State":"exited","ExitCode":1},{"Service":"gateway-2","State":"exited","ExitCode":1}]';
    expect(parseComposePs(lines)).toEqual(parseComposePs(array));
    expect(parseComposePs("   ")).toEqual([]);
  });
});

describe("بوّابةُ رحلةِ الفوضى تُقرأُ من قرارِ التوزيعِ لا من البيئةِ", () => {
  test("لا تُفتَحُ الرحلةُ بآليةٍ داخلَ العمليةِ — وهي المُقرَّرةُ اليومَ", () => {
    expect(rideIsUnlockable("in-process")).toBe(false);
    expect(rideIsUnlockable(DECIDED_EVENT_DISTRIBUTION)).toBe(
      distributionCrossesProcessBoundary(DECIDED_EVENT_DISTRIBUTION),
    );
  });

  test("لا متغيّرَ بيئةٍ يفتحُ الرحلةَ — الحكمُ دالّةٌ في وسيطِها وحدَه", () => {
    process.env.F5_06_FORCE_RIDE = "1";
    try {
      expect(rideIsUnlockable("in-process")).toBe(false);
    } finally {
      delete process.env.F5_06_FORCE_RIDE;
    }
  });
});
