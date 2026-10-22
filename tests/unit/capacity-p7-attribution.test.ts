import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type EgressTimelineBot,
  oldestPendingKind,
  pendingAgeByKind,
  summarizeEgressTimeline,
} from "../../deploy/capacity-run/load/p7-attribution.ts";

const line = (t: number, bot: string, status: number) => JSON.stringify({ t, bot, status });

function botOf(byBot: Readonly<Record<string, EgressTimelineBot>>, bot: string): EgressTimelineBot {
  const b = byBot[bot];
  if (b === undefined) throw new Error(`لا سجلَّ للبوت ${bot}`);
  return b;
}

describe("pendingAgeByKind / oldestPendingKind", () => {
  test("يحوّلُ صفوفَ Postgres النصّيةَ ويختارُ النوعَ الأقدم", () => {
    const byKind = pendingAgeByKind([
      { kind: "offer", n: "4810", oldest: "61.7" },
      { kind: "rider_trip_notice", n: "5623", oldest: "127.4" },
    ]);
    expect(byKind).toEqual({
      offer: { pending: 4810, oldestPendingSec: 62 },
      rider_trip_notice: { pending: 5623, oldestPendingSec: 127 },
    });
    expect(oldestPendingKind(byKind)).toBe("rider_trip_notice");
  });

  test("لا معلّقَ ⇒ null (لا يُختلَقُ نوعٌ)", () => {
    expect(oldestPendingKind(pendingAgeByKind([]))).toBeNull();
    expect(oldestPendingKind(pendingAgeByKind([{ kind: "offer", n: 0, oldest: null }]))).toBeNull();
  });
});

describe("summarizeEgressTimeline", () => {
  test("يعدُّ لكلِّ بوتٍ بالثانية ويحسبُ الذروةَ والمعدّلَين", () => {
    const since = 1_000_000;
    const lines = [
      line(since - 5, "rider", 200), // قبلَ النافذة: يُستبعَد
      line(since + 10, "rider", 200),
      line(since + 20, "rider", 200),
      line(since + 999, "rider", 429),
      line(since + 2_500, "rider", 200), // الثانيةُ 2؛ الثانيةُ 1 خاملة
      line(since + 100, "driver", 200),
      "not json",
      "",
    ];
    const tl = summarizeEgressTimeline(lines, since);
    const r = botOf(tl.byBot, "rider");
    expect(r.accepted).toBe(3);
    expect(r.rejected).toBe(1);
    expect(r.busySeconds).toBe(2);
    expect(r.peakPerSec).toBe(2);
    expect(r.perSecond).toEqual([2, 0, 1]);
    expect(r.meanPerBusySec).toBe(1.5);
    expect(r.meanPerSpanSec).toBe(1);
    expect(botOf(tl.byBot, "driver").accepted).toBe(1);
    expect(botOf(tl.byBot, "driver").perSecond).toEqual([1]);
  });

  test("يطابقُ عدَّ readMockEgress (القبولُ والرفضُ) على المدخلِ نفسِه", () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      line(10_000 + i * 37, i % 2 === 0 ? "rider" : "driver", i % 7 === 0 ? 429 : 200),
    );
    const tl = summarizeEgressTimeline(lines, null);
    const count = (bot: string, status: number) =>
      lines.filter((l) => {
        const r = JSON.parse(l) as { bot: string; status: number };
        return r.bot === bot && r.status === status;
      }).length;
    for (const bot of ["rider", "driver"]) {
      expect(botOf(tl.byBot, bot).accepted).toBe(count(bot, 200));
      expect(botOf(tl.byBot, bot).rejected).toBe(count(bot, 429));
      expect(botOf(tl.byBot, bot).perSecond.reduce((a, b) => a + b, 0)).toBe(count(bot, 200));
    }
  });
});

describe("db-audit — الرصدُ لا يمسُّ البوابة", () => {
  const src = readFileSync("deploy/capacity-run/load/db-audit.ts", "utf8");
  test("قاعدةُ stale_pending_outbox وعتبتُها 120ث كما هي", () => {
    expect(src).toContain(
      "if (snap.outbox.oldestPendingSec !== null && snap.outbox.oldestPendingSec > 120) {",
    );
    expect(src).toContain('rule: "stale_pending_outbox"');
  });
  test("oldestPendingSec ما زالَ يُقرأُ من min(created_at) لكلِّ الصفوفِ المعلّقة", () => {
    expect(src).toContain(
      'const pendingOldest = outbox.find((r) => r.status === "pending")?.oldest ?? null;',
    );
  });
  test("P7 في wave-report بلا تغيير (≤ 120s)", () => {
    const wr = readFileSync("deploy/capacity-run/load/wave-report.ts", "utf8");
    expect(wr).toContain('limit: "≤ 120s"');
    expect(wr).toContain("pass: pending === null || pending <= 120,");
  });
});
