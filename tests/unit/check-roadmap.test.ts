/**
 * الغرض: حراسةُ حاجزِ طزاجةِ الخارطةِ — `OPS-ROADMAP-GATE`.
 *
 * **ولِمَ اختبارٌ لحاجزٍ عمرُه المشروعُ؟** لأنَّه لم يكن له اختبارٌ ألبتَّةَ،
 * **وذلكَ هوَ كيفَ نجا عَماهُ**: كانَ يخرُجُ صفراً في أوّلِ دفعةِ فرعٍ لأنَّ
 * `event.before` أصفارٌ فيرمي `git diff` فيسلُكُ مسارَ `catch`. حاجزٌ بلا حالةٍ
 * سالبةٍ مقيسةٍ **دعوى** لا إنفاذٌ.
 *
 * وأشدُّ ما يُحرَسُ ههنا **مسارُ التعذُّرِ**: أن يكونَ خَرْجُه سقوطاً لا نجاحاً.
 */

import { describe, expect, it } from "bun:test";

import {
  evaluateRoadmapFreshness,
  ROADMAP_FILES,
  resolveRange,
} from "../../scripts/check-roadmap.mjs";

const ZERO_SHA = "0000000000000000000000000000000000000000";

describe("حكمُ طزاجةِ الخارطةِ — الدالّةُ النقيّةُ", () => {
  it("شيفرةٌ تحرَّكت وخارطةٌ لم تتحرّكْ ⇒ سقوطٌ", () => {
    const v = evaluateRoadmapFreshness(["apps/miniapp/src/x.ts"]);
    expect(v.ok).toBe(false);
    expect(v.implementation).toEqual(["apps/miniapp/src/x.ts"]);
  });

  it("‏`ROADMAP.md` يُجزئُ", () => {
    expect(evaluateRoadmapFreshness(["apps/miniapp/src/x.ts", "ROADMAP.md"]).ok).toBe(true);
  });

  it("‏`docs/ROADMAP-MASTER.md` يُجزئُ — وهيَ الخارطةُ المُصانةُ فعلاً", () => {
    expect(evaluateRoadmapFreshness(["scripts/g.ts", "docs/ROADMAP-MASTER.md"]).ok).toBe(true);
  });

  it("لا شيفرةَ ⇒ نجاحٌ بلا اشتراطِ خارطةٍ", () => {
    const v = evaluateRoadmapFreshness(["docs/SYSTEM_STATE.md", "README.md"]);
    expect(v.ok).toBe(true);
    expect(v.implementation).toEqual([]);
  });

  it("مدىً فارغٌ ⇒ نجاحٌ — ولا يُقرأُ شهادةً على شيءٍ", () => {
    expect(evaluateRoadmapFreshness([]).ok).toBe(true);
  });

  it("كلُّ جِذرِ تنفيذٍ مُعلَنٍ يُمسَكُ منفرداً", () => {
    for (const f of [
      "apps/gateway/src/a.ts",
      "packages/shared/b.ts",
      "supabase/migrations/1.sql",
      "scripts/check-x.ts",
      "docs/contracts/c.json",
      "package.json",
      ".github/workflows/ci.yml",
    ]) {
      expect(evaluateRoadmapFreshness([f]).ok).toBe(false);
    }
  });

  it("وثيقةٌ ليست تنفيذاً لا تُوقِظُ الحاجزَ — فلا يُطلَبُ سطرُ خارطةٍ لتصحيحِ مطبعةٍ", () => {
    for (const f of ["docs/adr/0001-x.md", "docs/evidence/y.md", "ROADMAP.md", "bun.lock"]) {
      expect(evaluateRoadmapFreshness([f]).ok).toBe(true);
    }
  });

  it("‏`package.json` في حزمةٍ فرعيّةٍ يُمسَكُ بجِذرِ `packages/` لا بالجِذرِ المطلقِ", () => {
    expect(evaluateRoadmapFreshness(["packages/shared/package.json"]).ok).toBe(false);
  });

  it("ملفّا الخارطةِ اثنانِ بالنصِّ — والتكرارُ مُعلَنٌ لا مخفيٌّ", () => {
    expect(ROADMAP_FILES).toEqual(["ROADMAP.md", "docs/ROADMAP-MASTER.md"]);
  });
});

describe("حلُّ المدى — العطبُ الذي كانَ يُخرِجُ أخضرَ", () => {
  it("وسيطانِ صريحانِ يُستعملانِ كما هما", () => {
    expect(resolveRange("aaa", "bbb", {})).toEqual({ base: "aaa", head: "bbb" });
  });

  it("‏`BASE_SHA` أصفارٌ لا يُقبَلُ أساساً — وهذا هوَ العطبُ نفسُه", () => {
    const r = resolveRange(undefined, undefined, { BASE_SHA: ZERO_SHA, HEAD_SHA: "HEAD" });
    expect(typeof r === "string" ? r : r.base).not.toBe(ZERO_SHA);
  });

  it("‏`BASE_SHA` فارغٌ لا يُقبَلُ أساساً", () => {
    const r = resolveRange(undefined, undefined, { BASE_SHA: "   ", HEAD_SHA: "HEAD" });
    expect(typeof r === "string" ? r : r.base).not.toBe("");
  });

  /**
   * الرجوعُ إلى أصلِ الفرعِ من `main` — وهوَ ما يفعلُه جارُه في سيرِ العملِ
   * نفسِه (`ADR 0090`). ويُقاسُ على المستودعِ الحقيقيِّ: أساسٌ مُحَلٌّ إلى عقدةٍ.
   */
  it("لا `BASE_SHA` ⇒ يُرجَعُ إلى أصلِ الفرعِ من `main` لا إلى التخطّي", () => {
    const r = resolveRange(undefined, undefined, { HEAD_SHA: "HEAD" });
    expect(typeof r).not.toBe("string");
    if (typeof r !== "string") expect(r.base).toMatch(/^[0-9a-f]{40}$/);
  });

  it("‏`BASE_SHA` لعقدةٍ لا وجودَ لها ⇒ يُرجَعُ إلى الأصلِ لا يُرمى استثناءٌ", () => {
    const r = resolveRange(undefined, undefined, {
      BASE_SHA: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      HEAD_SHA: "HEAD",
    });
    expect(typeof r).not.toBe("string");
  });

  it("رأسٌ لا يُحَلُّ ⇒ **سببٌ مكتوبٌ** لا مدىً صامتٌ", () => {
    const r = resolveRange(undefined, undefined, { HEAD_SHA: "refs/heads/لا-وجود-له-قطعاً" });
    expect(typeof r).toBe("string");
    if (typeof r === "string") expect(r).toContain("No range resolves");
  });
});
