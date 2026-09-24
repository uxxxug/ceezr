/**
 * اختباراتُ موضعِ عنصرِ قياسِ سطحِ الراكبِ (`DEC-19` · `ADR 0185`) — سالبٌ مزروعٌ لكلِّ قاعدةٍ (`ح-7`)،
 * وإثباتٌ على المصدرِ الحقيقيِّ أنَّ العنصرَ في الحالةِ الجاهزةِ وحدَها. والرسمُ بـReact في
 * `apps/miniapp/src/surfaces/rider/welcome/surface-timing.test.tsx` (نسخةُ React الخاصّةُ بالتطبيقِ).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RIDER_SURFACE_TIMING_ID } from "../../apps/miniapp/src/surfaces/rider/welcome/surface-timing.ts";
import {
  evaluateRiderSurfaceTiming,
  FIRST_SCREEN,
  READY_ANCHOR,
  RIDER_ROOT,
  SPREAD,
  TIMING_MODULE,
} from "../../scripts/lib/rider-surface-timing.ts";

const ROOT = join(import.meta.dir, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const REAL = new Map([
  [FIRST_SCREEN, read(FIRST_SCREEN)],
  [RIDER_ROOT, read(RIDER_ROOT)],
  [TIMING_MODULE, read(TIMING_MODULE)],
]);
const rules = (m: Map<string, string>) => evaluateRiderSurfaceTiming(m).map((p) => p.rule);

describe("المصدرُ الحقيقيُّ", () => {
  it("لا مشكلةَ على الشيفرةِ كما هيَ", () => {
    expect(evaluateRiderSurfaceTiming(REAL)).toEqual([]);
  });
  it("المعرّفُ حرفاً waslah-rider-surface", () => {
    expect(RIDER_SURFACE_TIMING_ID).toBe("waslah-rider-surface");
  });
  it("العنصرُ هوَ السطرُ الأوّلُ من محتوى الترحيبِ في الفرعِ الجاهزِ بالضبطِ", () => {
    const src = read(FIRST_SCREEN);
    const ready = src.slice(src.indexOf(READY_ANCHOR));
    expect(ready).toMatch(
      /<p className="sys__body" \{\.\.\.riderSurfaceTimingAttribute\}>\s*\{t\("welcome\.line1"\)\}/,
    );
    expect(src.split(SPREAD).length - 1).toBe(1);
  });
});

describe("سوالبُ مزروعةٌ", () => {
  it("غيابُ العنصرِ ⇒ NO_TIMING_ELEMENT", () => {
    const m = new Map(REAL);
    m.set(FIRST_SCREEN, read(FIRST_SCREEN).replace(SPREAD, ""));
    expect(rules(m)).toContain("NO_TIMING_ELEMENT");
  });
  it("تكرارُه في الشاشةِ نفسِها ⇒ DUPLICATE_TIMING_ELEMENT", () => {
    const m = new Map(REAL);
    m.set(FIRST_SCREEN, `${read(FIRST_SCREEN)}\nconst x = <p ${SPREAD} />;`);
    expect(rules(m)).toContain("DUPLICATE_TIMING_ELEMENT");
  });
  it("عنصرٌ في شاشةٍ أخرى ⇒ OUTSIDE_FIRST_SCREEN + DUPLICATE_TIMING_ELEMENT", () => {
    const m = new Map(REAL);
    m.set("apps/miniapp/src/surfaces/rider/home/HomeScreen.tsx", `<h1 ${SPREAD} />`);
    const r = rules(m);
    expect(r).toContain("OUTSIDE_FIRST_SCREEN");
    expect(r).toContain("DUPLICATE_TIMING_ELEMENT");
  });
  it("«elementtiming» حرفاً خارجَ وحدةِ المعرّفِ ⇒ RAW_ELEMENTTIMING", () => {
    const m = new Map(REAL);
    m.set("apps/miniapp/src/system/Skeleton.tsx", '<div elementtiming="waslah-rider-surface" />');
    expect(rules(m)).toContain("RAW_ELEMENTTIMING");
  });
  it("نقلُ العنصرِ إلى حالةِ التحميلِ ⇒ NOT_IN_READY_BRANCH", () => {
    const src = read(FIRST_SCREEN).replace(SPREAD, "");
    const moved = src.replace(
      '<h1 id="wc-title" className="wc__title">',
      `<h1 id="wc-title" className="wc__title" ${SPREAD}>`,
    );
    const m = new Map(REAL);
    m.set(FIRST_SCREEN, moved);
    expect(rules(m)).toContain("NOT_IN_READY_BRANCH");
  });
  it("زوالُ مرساةِ الفرعِ الجاهزِ ⇒ NO_READY_ANCHOR", () => {
    const m = new Map(REAL);
    m.set(FIRST_SCREEN, read(FIRST_SCREEN).replace(READY_ANCHOR, "const rows = [];"));
    expect(rules(m)).toContain("NO_READY_ANCHOR");
  });
  it("لم تَعُد شاشةُ الترحيبِ الأولى ⇒ FIRST_SCREEN_MOVED", () => {
    const m = new Map(REAL);
    m.set(RIDER_ROOT, read(RIDER_ROOT).replace("useState(false);", "useState(true);"));
    expect(rules(m)).toContain("FIRST_SCREEN_MOVED");
  });
});
