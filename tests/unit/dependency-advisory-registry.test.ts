/**
 * الغرض: برهانُ سقوطِ حَكَمِ نشراتِ الثغراتِ **قاعدةً قاعدةً** بسالبةٍ مبذورةٍ
 *   لكلِّ واحدةٍ (`ح-7`) — ومعَها الطرفُ الموجَبُ عندَ الحدِّ بالضبطِ.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-20 (`SEC-15`).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0150
 *
 * وحاجزٌ لا يُبرهَنُ سقوطُه ليسَ حاجزاً بل تعليقاً يُنفَّذُ: أخضرُهُ لا يُفنَّدُ
 * لأنَّهُ لم يُرَ أحمرَ قطُّ.
 */

import { describe, expect, it } from "bun:test";

import {
  type ACK_OWNERS,
  type Acknowledgement,
  type Advisory,
  type AuditFacts,
  FAILING_SEVERITY,
  isFailingSeverity,
  JUDGE_RULE_NAMES,
  judgeAdvisories,
  MAX_ALLOWED_THRESHOLD,
  MIN_ACK_REASON_LENGTH,
  parseAuditOutput,
  SEVERITY_LADDER,
  summarizeAdvisories,
} from "../../scripts/lib/dependency-advisory-registry.ts";

const NOW = new Date("2026-09-20T00:00:00.000Z");

const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  package: "hono",
  id: 1193730,
  title: "Unbounded dot-notation nesting in parseBody() can cause memory exhaustion",
  url: "https://github.com/advisories/GHSA-g6gw-c38x-mqfc",
  severity: "moderate",
  vulnerableVersions: "<4.13.5",
  ...overrides,
});

const ack = (overrides: Partial<Acknowledgement> = {}): Acknowledgement => ({
  advisoryId: 1193730,
  package: "hono",
  reason: "سببٌ مكتوبٌ طويلٌ بما يكفي ليُقرأَ حُجّةً لا شعاراً: الرفعُ يكسرُ عقداً منقولاً ويُنتظَرُ إصلاحُه.",
  owner: "منفّذ المستودع",
  expiresOn: "2026-12-31",
  ...overrides,
});

const facts = (overrides: Partial<AuditFacts> = {}): AuditFacts => ({
  measured: true,
  advisories: [],
  failure: null,
  ...overrides,
});

const judge = (
  inputFacts: AuditFacts,
  acknowledgements: readonly Acknowledgement[] = [],
  threshold = FAILING_SEVERITY,
) => judgeAdvisories({ facts: inputFacts, acknowledgements, threshold, now: NOW });

const rules = (violations: readonly { rule: string }[]) => violations.map((v) => v.rule);

describe("حَكَمُ نشراتِ الثغراتِ — الطرفُ الموجَبُ", () => {
  it("لا نشرةَ ولا إقرارَ والفحصُ مقيسٌ: يمرُّ", () => {
    expect(judge(facts())).toEqual([]);
  });

  it("نشرةٌ دونَ الحدِّ تمرُّ بلا إقرارٍ — والحدُّ يُقاسُ لا يُخمَّنُ", () => {
    expect(judge(facts({ advisories: [advisory({ severity: "low" })] }))).toEqual([]);
  });

  it("نشرةٌ عندَ الحدِّ بالضبطِ بإقرارٍ حيٍّ تمرُّ", () => {
    expect(judge(facts({ advisories: [advisory()] }), [ack()])).toEqual([]);
  });

  it("سُلَّمُ الشدّةِ مرتَّبٌ صعوداً، والحدُّ المُعلَنُ فيهِ ولا يفوقُ المسموحَ", () => {
    expect(SEVERITY_LADDER.indexOf(FAILING_SEVERITY)).toBeGreaterThanOrEqual(0);
    expect(SEVERITY_LADDER.indexOf(FAILING_SEVERITY)).toBeLessThanOrEqual(
      SEVERITY_LADDER.indexOf(MAX_ALLOWED_THRESHOLD),
    );
    expect(isFailingSeverity("critical", FAILING_SEVERITY)).toBe(true);
    expect(isFailingSeverity("low", FAILING_SEVERITY)).toBe(false);
  });
});

describe("حَكَمُ نشراتِ الثغراتِ — سالبةٌ مبذورةٌ لكلِّ قاعدةٍ (ح-7)", () => {
  it("audit.measured — تعذُّرُ القياسِ يسقطُ ولو كانَت القائمةُ فارغةً", () => {
    const violations = judge(facts({ measured: false, failure: "لا شبكةَ" }));
    expect(rules(violations)).toContain("audit.measured");
  });

  it("audit.severity-known — شدّةٌ مجهولةٌ لا تُصنَّفُ دونَ الحدِّ صامتةً", () => {
    const violations = judge(facts({ advisories: [advisory({ severity: "spicy" })] }));
    expect(rules(violations)).toContain("audit.severity-known");
  });

  it("audit.no-unacknowledged — نشرةٌ عندَ الحدِّ بلا إقرارٍ تسقطُ", () => {
    const violations = judge(facts({ advisories: [advisory()] }));
    expect(rules(violations)).toEqual(["audit.no-unacknowledged"]);
  });

  it("ack.reasoned — سببٌ أقصرُ من الحدِّ ليسَ سبباً", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [ack({ reason: "معروفٌ" })]);
    expect(rules(violations)).toContain("ack.reasoned");
    expect(MIN_ACK_REASON_LENGTH).toBeGreaterThan(20);
  });

  it("ack.owned — مالكٌ خارجَ القائمةِ المغلقةِ يسقطُ", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [
      ack({ owner: "أحدُهم" as (typeof ACK_OWNERS)[number] }),
    ]);
    expect(rules(violations)).toContain("ack.owned");
  });

  it("ack.not-expired — إقرارٌ انقضى لا يشتري صمتاً، والنشرةُ تسقطُ معَه", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [
      ack({ expiresOn: "2026-09-19" }),
    ]);
    expect(rules(violations)).toContain("ack.not-expired");
    expect(rules(violations)).toContain("audit.no-unacknowledged");
  });

  it("ack.not-expired — تاريخٌ بصيغةٍ غيرِ الصيغةِ يسقطُ ولا يُقرأُ حيّاً", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [
      ack({ expiresOn: "ديسمبر 2026" }),
    ]);
    expect(rules(violations)).toContain("ack.not-expired");
    expect(rules(violations)).toContain("audit.no-unacknowledged");
  });

  it("ack.matches-advisory — إقرارٌ ميّتٌ لا تُقابِلُه نشرةٌ قائمةٌ يسقطُ", () => {
    const violations = judge(facts(), [ack()]);
    expect(rules(violations)).toContain("ack.matches-advisory");
  });

  it("ack.matches-advisory — المطابقةُ بالحزمةِ لا بالمعرِّفِ وحدَه", () => {
    const violations = judge(facts({ advisories: [advisory({ package: "socket.io" })] }), [ack()]);
    expect(rules(violations)).toContain("ack.matches-advisory");
  });

  it("ack.unique — إقرارانِ لنشرةٍ واحدةٍ يتناقضانِ بلا حاكمٍ", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [ack(), ack()]);
    expect(rules(violations)).toContain("ack.unique");
  });

  it("threshold.sane — حدٌّ خارجَ السُّلَّمِ يسقطُ", () => {
    const violations = judge(facts(), [], "لا شيءَ" as (typeof SEVERITY_LADDER)[number]);
    expect(rules(violations)).toContain("threshold.sane");
  });

  it("threshold.sane — رفعُ الحدِّ فوقَ المسموحِ تليينٌ للبوّابةِ فيسقطُ", () => {
    const violations = judge(facts({ advisories: [advisory()] }), [], "critical");
    expect(rules(violations)).toContain("threshold.sane");
  });

  it("كلُّ قاعدةٍ في المُعجَمِ لها سالبةٌ في هذهِ الحزمةِ", () => {
    const covered = new Set<(typeof JUDGE_RULE_NAMES)[number]>();
    covered.add("audit.measured");
    covered.add("audit.severity-known");
    covered.add("audit.no-unacknowledged");
    covered.add("ack.reasoned");
    covered.add("ack.owned");
    covered.add("ack.not-expired");
    covered.add("ack.matches-advisory");
    covered.add("ack.unique");
    covered.add("threshold.sane");
    expect([...JUDGE_RULE_NAMES].sort()).toEqual([...covered].sort());
  });
});

describe("قراءةُ مُخرَجِ الفحصِ — الفارغُ ليسَ «لا ثغرةَ»", () => {
  it("يقرأُ كائنَ حزمٍ حقيقيَّ الشكلِ", () => {
    const parsed = parseAuditOutput(
      JSON.stringify({
        hono: [
          {
            id: 1193730,
            url: "https://github.com/advisories/GHSA-g6gw-c38x-mqfc",
            title: "t",
            severity: "moderate",
            vulnerable_versions: "<4.13.5",
          },
        ],
      }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.package).toBe("hono");
    expect(parsed[0]?.vulnerableVersions).toBe("<4.13.5");
  });

  it("يرمي على نصٍّ فارغٍ ولا يَرُدُّ قائمةً فارغةً", () => {
    expect(() => parseAuditOutput("   ")).toThrow();
  });

  it("يرمي على مصفوفةٍ في الجِذرِ لا كائنِ حزمٍ", () => {
    expect(() => parseAuditOutput("[]")).toThrow();
  });

  it("يرمي على نشرةٍ بلا معرِّفٍ أو بلا شدّةٍ", () => {
    expect(() => parseAuditOutput(JSON.stringify({ hono: [{ title: "t" }] }))).toThrow();
  });

  it("يرمي على قيمةٍ ليسَت مصفوفةَ نشراتٍ", () => {
    expect(() => parseAuditOutput(JSON.stringify({ hono: { id: 1 } }))).toThrow();
  });

  it("الوصفُ يذكرُ العددَ والشدّةَ والحدَّ", () => {
    const text = summarizeAdvisories(
      facts({ advisories: [advisory(), advisory({ id: 2, severity: "low" })] }),
      FAILING_SEVERITY,
    );
    expect(text).toContain("moderate");
    expect(text).toContain("low");
    expect(text).toContain("2");
  });
});
