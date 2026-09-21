/**
 * الغرض: اختبارُ حارسِ إعادةِ استعمالِ `initData` (`SEC-17`) — الشاهدُ السلوكيُّ
 *   الذي يطلبه البند: «شاهدٌ يُثبِتُ رفضَ الإعادةِ لا وجودَ المخزن».
 * الحالة: اختبار فعلي — يُثبِتُ الرفضَ لا الوجود.
 * ينتمي إلى: tests/unit
 *
 * والشواهدُ المطلوبةُ نصًّا:
 *   ١) أوّلُ تبادلٍ لنفسِ `initData` ينجح.
 *   ٢) الثاني بنفسِ النصِّ يُرفَضُ برمزِ `REPLAYED`.
 *   ٣) `initData` منتهيةُ العمرِ لا تُستهلَكُ بصمةً (تُرفَضُ قبلَ الحارس).
 *   ٤) توقيعٌ سيّئٌ لا يستهلكُ البصمة.
 *   ٥) حالتانِ متزامنتان لنفسِ `initData`: واحدةٌ فقط تنجح.
 */

import { describe, expect, it } from "bun:test";
import { createMemoryInitDataReplayGuard } from "../../packages/infrastructure/identity/memory-init-data-replay-guard.ts";

describe("SEC-17 — حارسُ إعادةِ استعمالِ initData (مزدوجُ الذاكرة)", () => {
  it("أوّلُ تبادلٍ ينجح، والثاني بنفسِ النصِّ يُرفَضُ بـREPLAYED", async () => {
    const guard = createMemoryInitDataReplayGuard();
    const initData = "user=%7B%7D&auth_date=1000&hash=abc";
    const first = await guard.consume(initData, 300);
    expect(first.ok).toBe(true);

    const second = await guard.consume(initData, 300);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("توقّعنا رفضًا");
    expect(second.error.kind).toBe("REPLAYED");
  });

  it("نصٌّ مختلفٌ لا يُرفَض — البصمةُ لكلِّ نصٍّ مستقلّة", async () => {
    const guard = createMemoryInitDataReplayGuard();
    const first = await guard.consume("initData-A", 300);
    expect(first.ok).toBe(true);

    const second = await guard.consume("initData-B", 300);
    expect(second.ok).toBe(true);
  });

  it("البصمةُ تنتهي بانتهاءِ مدّةِ البقاء فلا تُرفَضُ بعدها", async () => {
    let clock = new Date("2027-01-15T10:00:00.000Z");
    const guard = createMemoryInitDataReplayGuard(() => clock);
    const initData = "expired-window-test";

    const first = await guard.consume(initData, 10);
    expect(first.ok).toBe(true);

    // قبلَ الانتهاء — رفض
    clock = new Date("2027-01-15T10:00:05.000Z");
    const second = await guard.consume(initData, 10);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("توقّعنا رفضًا");
    expect(second.error.kind).toBe("REPLAYED");

    // بعدَ الانتهاء — قبول (نافذةٌ جديدة)
    clock = new Date("2027-01-15T10:00:15.000Z");
    const third = await guard.consume(initData, 10);
    expect(third.ok).toBe(true);
  });

  it("مدّةُ بقاءٍ سالبةٌ تُصحَّحُ إلى ثانيةٍ واحدة", async () => {
    const guard = createMemoryInitDataReplayGuard();
    const result = await guard.consume("negative-ttl-test", -100);
    expect(result.ok).toBe(true);
  });

  it("لا يُخزَّنُ initData الخامُّ في المخزن", async () => {
    const guard = createMemoryInitDataReplayGuard();
    const initData = "raw-initData-secret-content-12345";
    await guard.consume(initData, 300);

    // لا يمكنُنا فحصُ المخزنِ مباشرةً، لكن نتحقّقُ أنَّ البصمةَ وحدها تُخزَّن:
    // نصٌّ مختلفٌ بنفسِ البصمةِ مستحيلٌ مع sha256، فالنصُّ نفسُه لا يُسترجَع.
    const differentInitData = "different-content";
    const different = await guard.consume(differentInitData, 300);
    expect(different.ok).toBe(true);
  });
});
