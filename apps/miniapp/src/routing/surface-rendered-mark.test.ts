/**
 * الغرض: إثباتُ توقيتِ علامةِ `waslah-surface-rendered` (`DEC-19` · `F1-09` الصفوفُ 3–5):
 *   تُوضَعُ في استدعاءِ `requestAnimationFrame` **الثاني** — لا قبلَه ولا بإطارٍ ثالثٍ.
 * الحالة: منفّذ فعلياً — قرارُ المالكِ `DEC-19` (2026-09-24) · `ADR 0185`.
 * ينتمي إلى: apps/miniapp/src/routing
 *
 * حدٌّ معلَنٌ: المستودعُ بلا بيئةِ DOM، فيُختبَرُ **التوقيتُ النسبيُّ للإطاراتِ** بمُجدوِلٍ
 * مصنوعٍ. ورسمُ المتصفّحِ الفعليُّ يُثبتُه `scripts/measure-tti.ts` وحَكَمُ
 * `rider-surface-budget.ts` (`RENDERED_BEFORE_PAINT` · `NO_SURFACE_RENDERED`).
 */

import { describe, expect, it } from "bun:test";
import { scheduleSurfaceRenderedMark } from "./RoleRouter.tsx";

/** مُجدوِلُ إطاراتٍ مصنوعٌ: كلُّ `flush` يُنفِّذُ ما جُدوِلَ قبلَه — إطارٌ واحدٌ. */
function fakeFrames() {
  let queue: Array<() => void> = [];
  return {
    raf: (callback: () => void) => {
      queue.push(callback);
    },
    flush: () => {
      const current = queue;
      queue = [];
      for (const callback of current) callback();
    },
    pending: () => queue.length,
  };
}

describe("علامةُ بلوغِ السطحِ المرسومِ — DEC-19", () => {
  it("لا علامةَ قبلَ أيِّ إطارٍ", () => {
    const frames = fakeFrames();
    const marks: string[] = [];
    scheduleSurfaceRenderedMark(frames.raf, (name) => marks.push(name));
    expect(marks).toEqual([]);
  });

  it("لا علامةَ بعدَ الإطارِ الأوّلِ وحدَه (سالبٌ مزروعٌ: علامةٌ قبلَ الرسمِ)", () => {
    const frames = fakeFrames();
    const marks: string[] = [];
    scheduleSurfaceRenderedMark(frames.raf, (name) => marks.push(name));
    frames.flush();
    expect(marks).toEqual([]);
    expect(frames.pending()).toBe(1);
  });

  it("العلامةُ في الإطارِ الثاني بالاسمِ الحرفيِّ ومرّةً واحدةً", () => {
    const frames = fakeFrames();
    const marks: string[] = [];
    scheduleSurfaceRenderedMark(frames.raf, (name) => marks.push(name));
    frames.flush();
    frames.flush();
    expect(marks).toEqual(["waslah-surface-rendered"]);
    frames.flush();
    expect(marks).toEqual(["waslah-surface-rendered"]);
    expect(frames.pending()).toBe(0);
  });
});
