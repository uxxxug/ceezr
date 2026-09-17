/**
 * الغرض: **سالبةٌ مزروعةٌ لكلِّ قاعدةٍ** في حاجزِ سِجلِّ ضوابطِ `F8-08` (`ح-7`)،
 *   وقياسُ السِجلِّ الحقيقيِّ على القرصِ الحقيقيِّ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-16.
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0133
 *
 * حاجزٌ لا تُزرَعُ لهُ سالبةٌ لا يُعلَمُ أنَّهُ يقيسُ شيئاً؛ فقد يمرُّ أخضرَ وهوَ
 * لا يقرأُ شيئاً أصلاً. فلكلِّ قاعدةٍ ههنا خرقٌ مبذورٌ **يجبُ أن يُمسَكَ**.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MIN_RATIONALE_LENGTH,
  REQUIRED_CONTROL_COUNT,
  readF8_08Symbol,
  SECURITY_CONTROLS,
  type SecurityControl,
  securityControlViolations,
  summarizeControls,
} from "../../scripts/lib/security-controls-registry.ts";

const repoRoot = resolve(import.meta.dir, "../..");
const roadmapText = readFileSync(resolve(repoRoot, "docs/ROADMAP-MASTER.md"), "utf8");
const pathExists = (path: string) => existsSync(resolve(repoRoot, path));

/** رمزٌ `[ ]` يُرضي القاعدةَ المُشتَقّةَ، لِتُعزَلَ القاعدةُ المقيسةُ وحدَها. */
const OPEN_ROW =
  "| F8-08 | 16 ضابط أمن، وأهمها **التفويض على مستوى الكائن** في كل مسار | `[ ]` |\n";

const rulesOf = (controls: readonly SecurityControl[], text = OPEN_ROW) =>
  securityControlViolations({ roadmapText: text, pathExists, controls }).map((v) => v.rule);

const sound: SecurityControl = {
  id: "SEC-XX",
  name: "ضابطٌ مبذورٌ",
  state: "built",
  rationale: "حيثيّةٌ طويلةٌ بما يكفي لتتجاوزَ الحدَّ الأدنى المفروضَ على الحيثيّاتِ في السِجلِّ.",
  evidence: "docs/evidence/security/F8-08-20260916.md",
  guard: "scripts/check-object-authorization.ts",
  owner: "منفّذ المستودع",
  blockedBy: null,
};

/** يبني سِجلّاً بالعددِ المفروضِ بالضبطِ، فلا تختلطَ قاعدةُ العددِ بغيرِها. */
const sixteen = (override: Partial<SecurityControl> = {}): SecurityControl[] =>
  Array.from({ length: REQUIRED_CONTROL_COUNT }, (_, i) =>
    i === 0 ? { ...sound, ...override } : { ...sound, id: `SEC-${i + 1}` },
  );

describe("السِجلُّ الحقيقيُّ على القرصِ الحقيقيِّ", () => {
  test("لا خرقَ فيهِ البتّةَ", () => {
    const violations = securityControlViolations({ roadmapText, pathExists });
    expect(violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
  });

  test("عددُه هوَ العددُ الذي يشترطُه نصُّ البندِ", () => {
    expect(SECURITY_CONTROLS).toHaveLength(REQUIRED_CONTROL_COUNT);
  });

  test("معرِّفاتُه متفرِّدةٌ", () => {
    expect(new Set(SECURITY_CONTROLS.map((c) => c.id)).size).toBe(REQUIRED_CONTROL_COUNT);
  });

  test("كلُّ مبنيٍّ لهُ دليلٌ وحاجزٌ موجودانِ فعلاً على القرصِ", () => {
    for (const control of SECURITY_CONTROLS.filter((c) => c.state === "built")) {
      expect(control.evidence, control.id).not.toBeNull();
      expect(control.guard, control.id).not.toBeNull();
      expect(pathExists(control.evidence as string), `${control.id}: ${control.evidence}`).toBe(
        true,
      );
      expect(pathExists(control.guard as string), `${control.id}: ${control.guard}`).toBe(true);
    }
  });

  test("كلُّ عائقٍ مُعلَنٍ لهُ مالكٌ ليسَ منفِّذَ المستودَعِ", () => {
    // عائقٌ يملكُه المنفِّذُ ليسَ عائقاً بل عملاً مؤجَّلاً بلا سببٍ.
    for (const control of SECURITY_CONTROLS.filter((c) => c.blockedBy !== null)) {
      expect(control.owner, control.id).not.toBe("منفّذ المستودع");
    }
  });

  test("رمزُ البندِ في الخارطةِ مقروءٌ وهوَ `[ ]` ما دامَ فيها غيرُ مبنيٍّ", () => {
    expect(readF8_08Symbol(roadmapText)).toBe("[ ]");
    expect(SECURITY_CONTROLS.every((c) => c.state === "built")).toBe(false);
  });

  test("المُلخَّصُ يُطابقُ العدَّ اليدويَّ", () => {
    const summary = summarizeControls();
    expect(summary.built + summary.partial + summary.notBuilt).toBe(REQUIRED_CONTROL_COUNT);
    expect(summary.built).toBeGreaterThan(0);
  });
});

describe("سالبةٌ مزروعةٌ لكلِّ قاعدةٍ", () => {
  test("`count.matches-item-text` — خمسةَ عشرَ لا ستّةَ عشرَ", () => {
    expect(rulesOf(sixteen().slice(0, 15))).toContain("count.matches-item-text");
  });

  test("`count.matches-item-text` — سبعةَ عشرَ أيضاً خرقٌ، لا الزيادةُ فضلٌ", () => {
    expect(rulesOf([...sixteen(), { ...sound, id: "SEC-17" }])).toContain(
      "count.matches-item-text",
    );
  });

  test("`id.unique` — معرِّفٌ مكرَّرٌ", () => {
    const controls = sixteen();
    controls[15] = { ...sound, id: "SEC-XX" };
    expect(rulesOf(controls)).toContain("id.unique");
  });

  test("`rationale.written` — «مبنيٌّ» ليسَ حيثيّةً", () => {
    expect(rulesOf(sixteen({ rationale: "مبنيٌّ" }))).toContain("rationale.written");
  });

  test("`rationale.written` — حرفٌ واحدٌ دونَ الحدِّ يُمسَكُ", () => {
    // الحدُّ حدٌّ لا اقتراحٌ: يُقاسُ عندَ حافّتِه لا عندَ منتصفِه.
    expect(rulesOf(sixteen({ rationale: "ء".repeat(MIN_RATIONALE_LENGTH - 1) }))).toContain(
      "rationale.written",
    );
    expect(rulesOf(sixteen({ rationale: "ء".repeat(MIN_RATIONALE_LENGTH) }))).not.toContain(
      "rationale.written",
    );
  });

  test("`built.requires-evidence-and-guard` — دعوى بناءٍ بلا دليلٍ", () => {
    expect(rulesOf(sixteen({ evidence: null }))).toContain("built.requires-evidence-and-guard");
  });

  test("`built.requires-evidence-and-guard` — دعوى بناءٍ بلا حاجزٍ", () => {
    expect(rulesOf(sixteen({ guard: null }))).toContain("built.requires-evidence-and-guard");
  });

  test("`built.paths-exist` — دليلٌ مذكورٌ لا وجودَ لهُ", () => {
    // وهذهِ أخطرُ السوالبِ: مسارٌ مكتوبٌ يُقرأُ إثباتاً ولا يُفتَحُ أبداً.
    expect(rulesOf(sixteen({ evidence: "docs/evidence/security/لا-وجودَ-لهُ.md" }))).toContain(
      "built.paths-exist",
    );
  });

  test("`built.no-gap-measurement` — فجوةٌ مقيسةٌ على ضابطٍ يُدَّعى بناؤُه", () => {
    // تناقضٌ يُمسَكُ آليّاً: إمّا الفجوةُ قائمةٌ فالحالُ ليسَ `built`، وإمّا زالَت
    // فالملفُّ دليلُ بناءٍ يُذكَرُ في `evidence`.
    expect(
      rulesOf(sixteen({ gapMeasurement: "docs/evidence/security/SEC-10-20260917.md" })),
    ).toContain("built.no-gap-measurement");
  });

  test("`gap-measurement.exists` — قياسُ فجوةٍ مذكورٌ لا وجودَ لهُ", () => {
    const rules = rulesOf(
      sixteen({
        state: "partial",
        evidence: null,
        gapMeasurement: "docs/evidence/security/لا-وجودَ-لهُ.md",
      }),
    );
    expect(rules).toContain("gap-measurement.exists");
  });

  test("مُوجَبةٌ: قياسُ فجوةٍ موجودٌ على ضابطٍ جزئيٍّ لا يُسقِطُ شيئاً", () => {
    const rules = rulesOf(
      sixteen({
        state: "partial",
        evidence: null,
        gapMeasurement: "docs/evidence/security/SEC-10-20260917.md",
      }),
    );
    expect(rules).not.toContain("gap-measurement.exists");
    expect(rules).not.toContain("built.no-gap-measurement");
    expect(rules).not.toContain("unbuilt.no-evidence-claim");
  });

  test("`guard.exists` — حاجزٌ مذكورٌ لا وجودَ لهُ", () => {
    expect(rulesOf(sixteen({ guard: "scripts/check-وهمٌ.ts" }))).toContain("guard.exists");
  });

  test("`guard.exists` يُمسِكُ الوهمَ حتّى على ضابطٍ غيرِ مبنيٍّ", () => {
    const rules = rulesOf(
      sixteen({ state: "partial", evidence: null, guard: "scripts/check-وهمٌ.ts" }),
    );
    expect(rules).toContain("guard.exists");
  });

  test("`unbuilt.no-evidence-claim` — دليلٌ على ما لم يُبنَ", () => {
    expect(rulesOf(sixteen({ state: "not-built", guard: null }))).toContain(
      "unbuilt.no-evidence-claim",
    );
  });

  test("`roadmap.row-readable` — صفٌّ غيرُ مقروءٍ", () => {
    expect(rulesOf(sixteen(), "# خارطةٌ بلا صفِّ F8-08\n")).toContain("roadmap.row-readable");
  });

  test("`symbol.derived-from-registry` — رمزٌ مرفوعٌ بيدٍ والسِجلُّ لم يكتمِل", () => {
    const controls = sixteen();
    controls[1] = { ...sound, id: "SEC-2", state: "partial", evidence: null, guard: null };
    const closed = "| F8-08 | 16 ضابط أمن | `[x]` |\n";
    expect(rulesOf(controls, closed)).toContain("symbol.derived-from-registry");
  });

  test("`symbol.derived-from-registry` — `[~]` مرفوضٌ كما `[x]`", () => {
    // التقدُّمُ الجزئيُّ دعوى أيضاً، ودعوى بلا سندٍ مردودةٌ أيّاً كانَ رمزُها.
    const controls = sixteen();
    controls[1] = { ...sound, id: "SEC-2", state: "not-built", evidence: null, guard: null };
    expect(rulesOf(controls, "| F8-08 | 16 ضابط أمن | `[~]` |\n")).toContain(
      "symbol.derived-from-registry",
    );
  });

  test("الرمزُ يُقبَلُ مرفوعاً **فقط** حينَ تكونُ الستّةَ عشرَ مبنيّةً", () => {
    // وهذا هوَ الطرفُ الموجَبُ: الحاجزُ لا يمنعُ الإغلاقَ أبداً، يمنعُه بلا سندٍ.
    expect(rulesOf(sixteen(), "| F8-08 | 16 ضابط أمن | `[x]` |\n")).not.toContain(
      "symbol.derived-from-registry",
    );
  });
});
