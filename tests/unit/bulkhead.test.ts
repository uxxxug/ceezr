/**
 * الغرض: اختبارُ حدِّ التزامنِ (`F8-04` · ADR-0079): الإشباعُ، والإفراجُ، وحمايةُ
 *    الإفراجِ المكرَّرِ، وألاّ يُغيِّرَ `snapshot` عدّاً.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-04`.
 * ينتمي إلى: tests/unit
 *
 * ## القيمةُ في الإفراجِ المكرَّرِ
 *
 * `permit.release()` يُنادى في `finally` وفي معالجِ خطأٍ معاً بأيسرِ سهوٍ. وبلا
 * حمايةٍ يُنقِصُ ذلكَ العدَّ مرّتَينِ عن زيادةٍ واحدةٍ، فيصيرُ الحدُّ **أوسعَ** من
 * المُعلَنِ بلا حدٍّ — وهوَ عيبٌ لا يُظهِرُه اختبارٌ موجَبٌ أبداً.
 */

import { describe, expect, test } from "bun:test";
import { createBulkhead } from "../../packages/shared/resilience/bulkhead.ts";

describe("حدُّ التزامنِ (F8-04)", () => {
  test("١) يُقبَلُ حتّى الحدِّ ثمَّ يُرَدُّ", () => {
    const bulkhead = createBulkhead({ maxConcurrent: 2 });
    expect(bulkhead.tryAcquire()).not.toBeNull();
    expect(bulkhead.tryAcquire()).not.toBeNull();
    expect(bulkhead.tryAcquire()).toBeNull();
    expect(bulkhead.snapshot()).toEqual({ inFlight: 2, maxConcurrent: 2 });
  });

  test("٢) الإفراجُ يُتيحُ نداءً جديداً", () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1 });
    const permit = bulkhead.tryAcquire();
    expect(permit).not.toBeNull();
    expect(bulkhead.tryAcquire()).toBeNull();
    permit?.release();
    expect(bulkhead.snapshot().inFlight).toBe(0);
    expect(bulkhead.tryAcquire()).not.toBeNull();
  });

  test("٣) الإفراجُ المكرَّرُ لا يُوسِّعُ الحدَّ", () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1 });
    const permit = bulkhead.tryAcquire();
    permit?.release();
    permit?.release();
    permit?.release();
    expect(bulkhead.snapshot().inFlight).toBe(0);
    expect(bulkhead.tryAcquire()).not.toBeNull();
    // ولو كانَ الإفراجُ المكرَّرُ يُنقِصُ العدَّ لصارَ سالباً فقُبِلَ نداءٌ ثانٍ.
    expect(bulkhead.tryAcquire()).toBeNull();
  });

  test("٤) `snapshot` قراءةٌ لا تحجزُ", () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1 });
    bulkhead.snapshot();
    bulkhead.snapshot();
    expect(bulkhead.snapshot().inFlight).toBe(0);
    expect(bulkhead.tryAcquire()).not.toBeNull();
  });

  test("٥) حدٌّ دونَ الواحدِ يُسقِطُ البناءَ لا يُصحَّحُ صامتاً", () => {
    expect(() => createBulkhead({ maxConcurrent: 0 })).toThrow();
  });

  test("٦) تصريحُ الحدِّ مُعلَنٌ في القراءةِ لتُفهَمَ نسبةُ الامتلاءِ", () => {
    const bulkhead = createBulkhead({ maxConcurrent: 5 });
    bulkhead.tryAcquire();
    expect(bulkhead.snapshot()).toEqual({ inFlight: 1, maxConcurrent: 5 });
  });
});
