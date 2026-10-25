/**
 * الغرض: LOAD-01M (الدورةُ الرابعة) — مولّدُ الحِملِ المختلط (load/mixed-telegram.ts): جدولٌ حتميٌّ من
 *   البذرة (الذراعانِ يتلقّيانِ التسلسلَ نفسَه)، ونسبُ الأنواعِ قريبةٌ من الأوزان، والتحديثاتُ يصنّفُها
 *   telegramUpdateKind في البوّابةِ إلى النوعِ نفسِه، ونطاقُ المعرّفاتِ خارجَ نطاقِ مولّدِ contact.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { telegramUpdateKind } from "../../apps/gateway/src/background/load-path-scope.ts";
import { updateActorId } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import { updateIdOf } from "../../apps/gateway/src/routes/update-dedup.ts";
import { buildMixedUpdate, planMixed, rng } from "../../deploy/capacity-run/load/mixed-telegram.ts";

const base = {
  rate: 20,
  sec: 60,
  kinds: { command: 0.5, message: 0.5 },
  chats: 3000,
  chatBase: 900_000_000,
  updateBase: 3_000_000_000,
  seed: 1,
};

describe("mixed-telegram — حِملٌ مختلطٌ حتميّ", () => {
  test("البذرةُ نفسُها ⇒ الجدولُ نفسُه حرفيًّا؛ وبذرةٌ أخرى ⇒ تسلسلٌ آخر", () => {
    expect(planMixed(base)).toEqual(planMixed(base));
    const other = planMixed({ ...base, seed: 2 }).map((p) => p.kind);
    expect(other).not.toEqual(planMixed(base).map((p) => p.kind));
    const r = rng(7);
    const s = [r(), r(), r()];
    const r2 = rng(7);
    expect([r2(), r2(), r2()]).toEqual(s);
  });

  test("العددُ = المعدّل × المدّة، والمواعيدُ منتظمة، والمحادثاتُ متناوبة", () => {
    const p = planMixed(base);
    expect(p).toHaveLength(1200);
    expect(p[0]?.atMs).toBe(0);
    expect(p[1]?.atMs).toBe(50);
    expect(p[1199]?.atMs).toBe(59950);
    expect(new Set(p.map((x) => x.updateId)).size).toBe(1200);
    expect(p[3]?.chat).toBe(900_000_003);
    expect(planMixed({ ...base, chats: 2 })[2]?.chat).toBe(900_000_000);
  });

  test("نسبُ الأنواعِ قريبةٌ من الأوزان (±3 نقاط على 1200)", () => {
    const p = planMixed({ ...base, kinds: { command: 0.25, message: 0.5, callback: 0.25 } });
    const share = (k: string) => p.filter((x) => x.kind === k).length / p.length;
    expect(Math.abs(share("command") - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(share("message") - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(share("callback") - 0.25)).toBeLessThan(0.03);
  });

  test("أخطاءُ الإعداد تُرفَضُ صراحةً", () => {
    expect(() => planMixed({ ...base, rate: 0 })).toThrow();
    expect(() => planMixed({ ...base, kinds: { contact: 1 } })).toThrow();
    expect(() => planMixed({ ...base, kinds: { command: 0 } })).toThrow();
  });

  test("البوّابةُ تصنّفُ كلَّ تحديثٍ إلى نوعِه، وتقرأُ update_id والفاعل", () => {
    for (const kind of ["command", "message", "callback"] as const) {
      const item = { seq: 0, atMs: 0, kind, chat: 900_000_001, updateId: 3_000_000_005 };
      const u = buildMixedUpdate(item, 1);
      expect(telegramUpdateKind(u)).toBe(kind);
      expect(updateIdOf(u)).toBe(3_000_000_005);
      expect(updateActorId(u)).toBe("900000001");
    }
  });

  test("النطاقُ خارجَ مولّدِ contact (nextUpdateId < 2e9) وهويّاتِ wave.sh", () => {
    const p = planMixed(base);
    expect(Math.min(...p.map((x) => x.updateId))).toBeGreaterThanOrEqual(2_000_000_000);
    // wave.sh: RIDER/DRIVER_SEQ_START = 6.2e6/8.2e6 + idx·1e5 (idx ≤ 99 ⇒ < 1.9e7)
    expect(Math.min(...p.map((x) => x.chat))).toBeGreaterThan(19_000_000);
  });
});
