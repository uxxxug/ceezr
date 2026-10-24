/**
 * S5 (ADR 0288 §ملحق 2026-10-18) — مُرسِلُ الردودِ الفوريُّ غيرُ الحاجبِ.
 *
 * المقيسُ الذي أوجبَه: `r11-wave-500` — مسارُ الوظيفةِ كانَ ينتظرُ إرسالَ الردِّ فصارَ إتمامُ
 * وظائفِ إثباتِ الهاتفِ بمعدّلِ دلوِ البوتِ (22ث → 62ث) ⇒ G1 = 7.98%.
 */
import { describe, expect, it } from "bun:test";
import { createTelegramReplyPool } from "../../apps/gateway/src/background/telegram-reply-pool.ts";

function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("S5 — مُرسِلُ الردودِ الفوريُّ", () => {
  it("١) الإيداعُ يعودُ فورًا ولو كانَ الإرسالُ معلّقًا", async () => {
    const pool = createTelegramReplyPool({ concurrency: 4, maxQueued: 10, maxWaitMs: 30_000 });
    const g = gate();
    const accepted = pool.submit("driver:1", () => g.promise);
    expect(accepted).toBe(true);
    expect(pool.stats().running).toBe(1);
    g.open();
    await pool.idle();
    expect(pool.stats()).toEqual({ queued: 0, running: 0, expiredLocal: 0, sent: 1 });
  });

  it("٢) ردودُ المستخدمِ الواحدِ بالتسلسلِ وبترتيبِ الإيداعِ؛ والمستخدمونَ المختلفونَ بالتوازي", async () => {
    const pool = createTelegramReplyPool({ concurrency: 4, maxQueued: 10, maxWaitMs: 30_000 });
    const order: string[] = [];
    const gA1 = gate();
    pool.submit("u:A", async () => {
      order.push("A1:start");
      await gA1.promise;
      order.push("A1:end");
    });
    pool.submit("u:A", async () => {
      order.push("A2");
    });
    pool.submit("u:B", async () => {
      order.push("B1");
    });
    await tick();
    // B لم ينتظرْ A، وA2 لم يسبقْ A1.
    expect(order).toEqual(["A1:start", "B1"]);
    gA1.open();
    await pool.idle();
    expect(order).toEqual(["A1:start", "B1", "A1:end", "A2"]);
  });

  it("٣) التوازي محدودٌ بـconcurrency", async () => {
    const pool = createTelegramReplyPool({ concurrency: 2, maxQueued: 10, maxWaitMs: 30_000 });
    const gates = [gate(), gate(), gate()];
    gates.forEach((g, i) => {
      pool.submit(`u:${i}`, () => g.promise);
    });
    expect(pool.stats().running).toBe(2);
    expect(pool.stats().queued).toBe(1);
    for (const g of gates) g.open();
    await pool.idle();
    expect(pool.stats().sent).toBe(3);
  });

  it("٤) الطابورُ الممتلئُ يرفضُ (فيُؤجَّلُ الردُّ للمُرسِلِ الخلفيِّ) — ذاكرةٌ بسقفٍ", () => {
    const pool = createTelegramReplyPool({ concurrency: 1, maxQueued: 2, maxWaitMs: 30_000 });
    const g = gate();
    expect(pool.submit("u:1", () => g.promise)).toBe(true); // يجري
    expect(pool.submit("u:2", () => g.promise)).toBe(true); // queued=1
    expect(pool.submit("u:3", () => g.promise)).toBe(true); // queued=2
    expect(pool.submit("u:4", () => g.promise)).toBe(false);
    g.open();
  });

  it("٥) ما انتظرَ أكثرَ من maxWaitMs لا يُرسَلُ هنا — ومعه لاحقُه للمستخدمِ نفسِه (الترتيبُ)", async () => {
    let nowMs = 1_000_000;
    const logs: string[] = [];
    const pool = createTelegramReplyPool({
      concurrency: 1,
      maxQueued: 10,
      maxWaitMs: 30_000,
      now: () => nowMs,
      log: (m) => logs.push(m),
    });
    const sent: string[] = [];
    const g = gate();
    pool.submit("u:X", async () => {
      await g.promise;
      sent.push("X1");
    });
    pool.submit("u:Y", async () => sent.push("Y1"));
    pool.submit("u:Y", async () => sent.push("Y2"));
    pool.submit("u:Z", async () => sent.push("Z1"));
    nowMs += 31_000; // تجاوزَ نصفَ الإيجارِ
    g.open();
    await pool.idle();
    expect(sent).toEqual(["X1"]);
    expect(pool.stats().expiredLocal).toBe(3);
    expect(logs.filter((m) => m === "telegram.replies.local_expired")).toHaveLength(2);
  });

  it("٦) فشلُ الإرسالِ يُسجَّلُ ولا يوقفُ المستخدمَ التاليَ", async () => {
    const logs: string[] = [];
    const pool = createTelegramReplyPool({
      concurrency: 1,
      maxQueued: 10,
      maxWaitMs: 30_000,
      log: (m) => logs.push(m),
    });
    const sent: string[] = [];
    pool.submit("u:1", async () => {
      throw new Error("boom");
    });
    pool.submit("u:2", async () => sent.push("2"));
    await pool.idle();
    expect(sent).toEqual(["2"]);
    expect(logs).toContain("telegram.replies.local_failed");
  });

  it("٧) LOAD-01M — المسارُ المرفوضُ لامتلاءٍ يبقى مؤجَّلًا: لاحقُه لا يسبقُه ولو فرغَ الطابور", async () => {
    let nowMs = 5_000_000;
    const pool = createTelegramReplyPool({
      concurrency: 1,
      maxQueued: 1,
      maxWaitMs: 30_000,
      now: () => nowMs,
    });
    const g = gate();
    const sent: string[] = [];
    expect(pool.submit("u:A", () => g.promise)).toBe(true); // يجري
    expect(pool.submit("u:B", async () => sent.push("B1"))).toBe(true); // queued=1
    expect(pool.submit("u:C", async () => sent.push("C1"))).toBe(false); // ممتلئ ⇒ مؤجَّل
    g.open();
    await pool.idle();
    expect(sent).toEqual(["B1"]);
    // الطابورُ فارغٌ الآن، لكنَّ C مؤجَّلٌ: ردُّه التالي يذهبُ للخلفيِّ أيضًا (لا يسبقُ C1).
    expect(pool.submit("u:C", async () => sent.push("C2"))).toBe(false);
    // مسارٌ آخرُ غيرُ مؤجَّلٍ يُقبَل.
    expect(pool.submit("u:D", async () => sent.push("D1"))).toBe(true);
    await pool.idle();
    // بعدَ نافذةِ التأجيلِ (2×maxWaitMs) يعودُ C للمُرسِلِ الفوريّ.
    nowMs += 60_001;
    expect(pool.submit("u:C", async () => sent.push("C3"))).toBe(true);
    await pool.idle();
    expect(sent).toEqual(["B1", "D1", "C3"]);
  });

  it("٨) LOAD-01M — المسارُ المنقضي محلّيًّا يبقى مؤجَّلًا أيضًا (لا يُرسَلُ لاحقُه قبلَ الخلفيّ)", async () => {
    let nowMs = 9_000_000;
    const pool = createTelegramReplyPool({
      concurrency: 1,
      maxQueued: 10,
      maxWaitMs: 30_000,
      now: () => nowMs,
    });
    const g = gate();
    const sent: string[] = [];
    pool.submit("u:X", async () => {
      await g.promise;
      sent.push("X1");
    });
    pool.submit("u:Y", async () => sent.push("Y1"));
    nowMs += 31_000;
    g.open();
    await pool.idle();
    expect(sent).toEqual(["X1"]); // Y1 انقضى ⇒ للخلفيّ
    expect(pool.submit("u:Y", async () => sent.push("Y2"))).toBe(false);
    await tick();
    expect(sent).toEqual(["X1"]);
  });
});
