/**
 * دلوُ الحدِّ الصادرِ (`CAP-002`/`F6-04`). الساعةُ مُحقونةٌ فلا نومَ في الاختبارِ
 * ولا اعتمادَ على زمنِ آلةٍ: النافذةُ المنزلقةُ تُختبَرُ بتحريكِ العقربِ لا بانتظارِه.
 */

import { describe, expect, it } from "bun:test";
import {
  createMemoryOutboundRateBucket,
  DEFAULT_OUTBOUND_RATE_LIMITS,
} from "../../packages/infrastructure/notification/outbound-rate-bucket.ts";

describe("دلوُ الحدِّ الصادرِ (CAP-002)", () => {
  it("يمنحُ حتى الحدِّ ثمَّ يمنعُ بانتظارٍ مُعلَنٍ", async () => {
    const now = 1_000_000;
    const bucket = createMemoryOutboundRateBucket(
      { global: { limit: 3, windowMs: 1000 }, chat: { limit: 1, windowMs: 1000 } },
      () => now,
    );

    expect((await bucket.acquire("global", "bot")).granted).toBe(true);
    expect((await bucket.acquire("global", "bot")).granted).toBe(true);
    expect((await bucket.acquire("global", "bot")).granted).toBe(true);

    const denied = await bucket.acquire("global", "bot");
    expect(denied.granted).toBe(false);
    // الانتظارُ يُقاسُ من أقدمِ ضربةٍ لا من الآنَ: النافذةُ منزلقةٌ لا ثابتةٌ.
    expect(denied.waitMs).toBe(1000);
  });

  it("النافذةُ منزلقةٌ: انقضاءُ أقدمِ ضربةٍ يفتحُ فتحةً واحدةً لا الدلوَ كلَّه", async () => {
    let now = 1_000_000;
    const bucket = createMemoryOutboundRateBucket(
      { global: { limit: 2, windowMs: 1000 }, chat: { limit: 1, windowMs: 1000 } },
      () => now,
    );

    await bucket.acquire("global", "bot"); // عندَ 1_000_000
    now += 400;
    await bucket.acquire("global", "bot"); // عندَ 1_000_400
    expect((await bucket.acquire("global", "bot")).granted).toBe(false);

    // بعدَ خروجِ الأولى من النافذةِ تُفتَحُ فتحةٌ واحدةٌ — والثانيةُ لا تزالُ داخلَها.
    now += 601;
    expect((await bucket.acquire("global", "bot")).granted).toBe(true);
    expect((await bucket.acquire("global", "bot")).granted).toBe(false);
  });

  it("النطاقانِ مستقلّانِ: محادثةٌ استنفدَت حصّتَها لا تمنعُ غيرَها", async () => {
    const now = 1_000_000;
    const bucket = createMemoryOutboundRateBucket(DEFAULT_OUTBOUND_RATE_LIMITS, () => now);

    expect((await bucket.acquire("chat", "111")).granted).toBe(true);
    expect((await bucket.acquire("chat", "111")).granted).toBe(false);
    expect((await bucket.acquire("chat", "222")).granted).toBe(true);
    expect((await bucket.acquire("global", "bot")).granted).toBe(true);
  });

  it("لا يُسرِّبُ مفاتيحَ المحادثاتِ: المُنقضي يُحذَفُ لا يتكدَّسُ", async () => {
    let now = 1_000_000;
    const bucket = createMemoryOutboundRateBucket(DEFAULT_OUTBOUND_RATE_LIMITS, () => now);

    for (let i = 0; i < 50; i += 1) await bucket.acquire("chat", `chat-${i}`);
    expect(bucket.size()).toBe(50);

    // بعدَ انقضاءِ النافذةِ لا يبقى مفتاحٌ: البوتُ يراسلُ آلافَ المحادثاتِ يوميّاً،
    // ودلوٌ يحتفظُ بمفتاحٍ لكلِّ من راسلَه منذُ الإقلاعِ تسريبُ ذاكرةٍ لا حدٌّ.
    now += 1001;
    await bucket.acquire("global", "bot");
    expect(bucket.size()).toBe(1);
  });

  it("الحدودُ الافتراضيّةُ دونَ حدودِ Bot API المُعلَنةِ لا عليها", () => {
    // ثلاثونَ في الثانيةِ للبوتِ وواحدةٌ للمحادثةِ هما المُعلَنانِ؛ والسيرُ على
    // الحافّةِ بالضبطِ يصطدمُ بها عندَ أوّلِ تفاوتِ ساعاتٍ بينَ نسختَينِ.
    expect(DEFAULT_OUTBOUND_RATE_LIMITS.global.limit).toBeLessThan(30);
    expect(DEFAULT_OUTBOUND_RATE_LIMITS.global.windowMs).toBe(1000);
    expect(DEFAULT_OUTBOUND_RATE_LIMITS.chat.limit).toBe(1);
  });
});
