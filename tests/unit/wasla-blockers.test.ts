/**
 * الغرض: قياسُ تفكيكِ سجلِّ الحواجزِ ومُصدِرِ إشهادِ CORE (`W-8` زيادةٌ ثانيةٌ /
 *   ADR 0087). **وأكثرُ الحالاتِ سالبةٌ**: تزرعُ خارطةً مُفسَدةً أو إشهاداً
 *   ملفَّقاً وتقيسُ **الرفضَ**، لأنَّ حاجزاً لا يُختبَرُ مسارُه الأحمرُ لا يُبرهِنُ
 *   شيئاً حينَ يكونُ أخضرَ.
 * الحالة: منفّذ فعلياً — `W-8`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: `W-9` عندَ ربطِ تمرينِ التحوُّلِ بحالةِ `B-5`.
 * ملاحظات مستقبلية: عندَ إغلاقِ تبعيّةٍ في الخارطةِ تتغيَّرُ الحالةُ المقروءةُ من
 *   نفسِها؛ ولا حالةَ ههنا تُثبِّتُ «مفتوحٌ» بنصٍّ مكتوبٍ يدوياً في اختبارٍ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  blockerStatus,
  isBlockerOpen,
  mentionedBlockerIds,
  openBlockers,
  parseBlockers,
  UnknownBlockerError,
} from "../../scripts/lib/wasla-blockers.ts";
import {
  type CoreSide,
  deriveReconciliation,
  isAttestationRefused,
  isIssuedAttestation,
  issueCoreAttestation,
} from "../../scripts/lib/wasla-migration-dry-run.ts";

const REAL_ROADMAP = readFileSync("ROADMAP.md", "utf8");

/** خارطةٌ اصطناعيّةٌ صغيرةٌ: تبعيّةٌ مُغلَقةٌ بدليلٍ، وقرارٌ مفتوحٌ، وحاجزٌ مفتوحٌ. */
function syntheticRoadmap(closureNote = "**CLOSED** by CORE `abc1234` on 2026-09-12"): string {
  return [
    "## Cross-repository dependencies on CORE, recorded 2026-09-11",
    "",
    "| # | What is missing in CORE | What it blocks here |",
    "|---|---|---|",
    `| DEP-CORE-007 | ~~No shared CORE environment~~ — ${closureNote} | nothing now |`,
    "",
    "## Owner decisions required, recorded 2026-09-11",
    "",
    "| # | Decision | Why it cannot be taken by an executor here |",
    "|---|---|---|",
    "| O-2 | Set the Redis secrets | secrets belong to the owner |",
    "",
    "## Blockers",
    "",
    "| # | Blocker | Impact | What unblocks it |",
    "|---|---|---|---|",
    "| B-5 | No production release approval | No production deployment | Explicit owner approval |",
    "",
    "## Migrated",
  ].join("\n");
}

describe("تفكيكُ الحواجزِ من الخارطةِ لا من سجلٍّ ثانٍ", () => {
  it("يقرأُ الأصنافَ الثلاثةَ من الخارطةِ الحقيقيّةِ، ولا يُعلِنُ حاجزاً من عندِه", () => {
    const blockers = parseBlockers(REAL_ROADMAP);
    const kinds = new Set(blockers.map((blocker) => blocker.kind));
    expect(kinds).toEqual(
      new Set(["CORE_DEPENDENCY", "OWNER_DECISION", "PROGRAMME_BLOCKER"] as const),
    );
    expect(blockers.length).toBeGreaterThanOrEqual(16);
    for (const blocker of blockers) expect(REAL_ROADMAP).toContain(blocker.id);
  });

  it("و`DEP-CORE-007` مفتوحٌ كما تُعلِنُه الخارطةُ — تُقرأُ حالتُه ولا تُفترَضُ", () => {
    expect(isBlockerOpen("DEP-CORE-007", parseBlockers(REAL_ROADMAP))).toBe(true);
  });

  it("والإغلاقُ يُقرأُ من الصفِّ: تبعيّةٌ مُغلَقةٌ بدليلٍ تُفكَّكُ `CLOSED` بسببِها", () => {
    const [dependency] = parseBlockers(syntheticRoadmap());
    expect(dependency?.status).toBe("CLOSED");
    expect(dependency?.closureNote ?? "").toContain("abc1234");
  });

  it("والشطبُ وحدَه لا يُقرأُ إغلاقاً — الشطبُ تنسيقٌ والإغلاقُ حكمٌ", () => {
    const roadmap = syntheticRoadmap("(no closure word here)");
    const [dependency] = parseBlockers(roadmap);
    expect(dependency?.status).toBe("OPEN");
    expect(dependency?.closureNote).toBeUndefined();
  });

  it("وصفٌّ يبدأُ بمعرّفٍ خارجَ قسمِ الحواجزِ لا يُقرأُ إعلاناً", () => {
    const roadmap = [
      "## Risks",
      "",
      "| Risk | Severity | Note |",
      "|---|---|---|",
      "| B-5 | high | a risk row that merely mentions the id |",
      "",
      "## Next",
    ].join("\n");
    expect(parseBlockers(roadmap)).toEqual([]);
  });

  it("وسؤالٌ عن معرّفٍ غيرِ مُعلَنٍ **يرمي** ولا يُجيبُ «مُغلَقٌ»", () => {
    const blockers = parseBlockers(syntheticRoadmap());
    expect(() => blockerStatus("DEP-CORE-998", blockers)).toThrow(UnknownBlockerError);
    expect(() => isBlockerOpen("B-98", blockers)).toThrow(UnknownBlockerError);
  });

  it("و`openBlockers` تُرجِعُ المفتوحةَ وحدَها، و`mentionedBlockerIds` تُميِّزُ الذكرَ من الإعلانِ", () => {
    const blockers = parseBlockers(syntheticRoadmap());
    expect(openBlockers(blockers).map((blocker) => blocker.id)).toEqual(["O-2", "B-5"]);
    expect(mentionedBlockerIds("نصٌّ يذكرُ B-5 وDEP-CORE-998 فقط")).toEqual(
      new Set(["B-5", "DEP-CORE-998"]),
    );
  });

  /**
   * ذِكرُ حاجزٍ أجنبيٍّ — وهذا الفرقُ ليسَ تخفيفاً: ما لا يملِكُه MOVE لا
   * تُقرأُ له حالةٌ في جدولِ MOVE، وما يملِكُه فالحاجزُ عليه كما كانَ.
   */
  it("والمذكورُ ببادِئةِ مستودَعٍ مالِكٍ يُسقَطُ، والعاري يبقى مذكوراً", () => {
    expect(mentionedBlockerIds("دورةُ نطاقِ المستأجرِ أغلقَت `CORE:B-23` عندَ مالِكِها")).toEqual(
      new Set(),
    );
    expect(mentionedBlockerIds("`MARKET:O-4` قرارُ مالِكٍ هناكَ")).toEqual(new Set());
    // والعاري لا يُسترُ بجوارِ أجنبيٍّ في نفسِ السطرِ.
    expect(mentionedBlockerIds("`CORE:B-23` ثمّ B-5 عندَنا")).toEqual(new Set(["B-5"]));
    /**
     * ولا ببادِئةٍ مختلَقةٍ: البابُ محصورٌ في مستودَعَينِ مُسمَّيَينِ. والمعرّفُ
     * المزروعُ ههنا `B-98` لا معرّفٌ جديدٌ: فله إعفاءٌ اصطناعيٌّ مُعلَنٌ لهذا
     * الملفِّ بعينِه في `scripts/check-blocker-registry.ts`، فلا يُزرَعُ في المستودَعِ
     * معرّفٌ بلا صفٍ ولا إعفاءٍ من أجلِ اختبارٍ.
     */
    expect(mentionedBlockerIds("`OTHER:B-98` ليسَ نطاقاً مُعترَفاً به")).toEqual(new Set(["B-98"]));
  });
});

describe("مُصدِرُ الإشهادِ يرفضُ بالإنشاءِ لا بالمراجعةِ", () => {
  const request = {
    readVia: "قارئُ CORE عبرَ عقدِ الأحداثِ",
    closedDependency: "DEP-CORE-007",
    measuredAt: "abc1234 · 2026-09-12",
  };

  it("يرفضُ ما دامَتِ التبعيّةُ مفتوحةً في الخارطةِ الحقيقيّةِ", () => {
    const result = issueCoreAttestation(request, parseBlockers(REAL_ROADMAP));
    expect(isAttestationRefused(result)).toBe(true);
    if (isAttestationRefused(result)) expect(result.reason).toContain("مفتوحةً");
  });

  it("ويرفضُ معرّفاً غيرَ مُعلَنٍ — فمعرّفٌ مُختلَقٌ لا يُقرأُ إغلاقاً", () => {
    const result = issueCoreAttestation(
      { ...request, closedDependency: "DEP-CORE-998" },
      parseBlockers(REAL_ROADMAP),
    );
    expect(isAttestationRefused(result)).toBe(true);
    if (isAttestationRefused(result)) expect(result.reason).toContain("غيرُ مُعلَنٍ");
  });

  it("ويرفضُ وصفَ قراءةٍ حشواً أو فارغاً حتّى معَ تبعيّةٍ مُغلَقةٍ", () => {
    const blockers = parseBlockers(syntheticRoadmap());
    for (const bad of ["", "  ", "TODO", "unknown", "لاحقاً"]) {
      const result = issueCoreAttestation({ ...request, readVia: bad }, blockers);
      expect(isAttestationRefused(result)).toBe(true);
    }
    const noMoment = issueCoreAttestation({ ...request, measuredAt: "TBD" }, blockers);
    expect(isAttestationRefused(noMoment)).toBe(true);
  });

  it("ويُصدِرُ إشهاداً موسوماً حينَ تُعلَنُ التبعيّةُ مُغلَقةً بدليلٍ", () => {
    const result = issueCoreAttestation(request, parseBlockers(syntheticRoadmap()));
    expect(isAttestationRefused(result)).toBe(false);
    expect(isIssuedAttestation(result)).toBe(true);
  });

  it("وكائنٌ بحقولٍ صحيحةٍ مكتوبٌ يداً **ليسَ** إشهاداً", () => {
    expect(isIssuedAttestation({ ...request })).toBe(false);
    expect(isIssuedAttestation(null)).toBe(false);
    expect(isIssuedAttestation("attested")).toBe(false);
  });
});

describe("التسويةُ لا تُقالُ على إشهادٍ ملفَّقٍ", () => {
  const forged = {
    readVia: "قارئُ CORE عبرَ عقدِ الأحداثِ",
    closedDependency: "DEP-CORE-007",
    measuredAt: "abc1234 · 2026-09-12",
  } as unknown as CoreSide["attestation"];

  it("إشهادٌ ملفَّقٌ وتطابقُ عددٍ ⇒ `UNVERIFIABLE` لا `RECONCILED`", () => {
    const record = deriveReconciliation(
      { table: "users", rows: 9 },
      { table: "users", rows: 9, attestation: forged },
    );
    expect(record.status).toBe("UNVERIFIABLE");
    expect(record.coreRows).toBeUndefined();
  });

  it("وإشهادٌ ملفَّقٌ واختلافُ عددٍ ⇒ `UNVERIFIABLE` لا `DIVERGED` — فالاختلافُ ادّعاءُ معرفةٍ", () => {
    const record = deriveReconciliation(
      { table: "users", rows: 9 },
      { table: "users", rows: 4, attestation: forged },
    );
    expect(record.status).toBe("UNVERIFIABLE");
  });

  it("وبإشهادٍ مُصدَرٍ على سجلٍّ مُغلَقٍ اصطناعيٍّ تعملُ المقارنةُ كما هيَ", () => {
    const issued = issueCoreAttestation(
      {
        readVia: "قارئُ CORE عبرَ عقدِ الأحداثِ",
        closedDependency: "DEP-CORE-007",
        measuredAt: "abc1234 · 2026-09-12",
      },
      parseBlockers(syntheticRoadmap()),
    );
    if (isAttestationRefused(issued)) throw new Error(issued.reason);
    expect(
      deriveReconciliation(
        { table: "users", rows: 9 },
        { table: "users", rows: 9, attestation: issued },
      ).status,
    ).toBe("RECONCILED");
    expect(
      deriveReconciliation(
        { table: "users", rows: 9 },
        { table: "users", rows: 4, attestation: issued },
      ).status,
    ).toBe("DIVERGED");
  });
});
