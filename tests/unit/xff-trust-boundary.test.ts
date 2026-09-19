/**
 * الغرض: **توصيفُ** سلوكِ قراءةِ `x-forwarded-for` كما هوَ اليومَ — لا تثبيتُ قاعدةٍ
 *   أمنيةٍ ولا إعلانُ حدِّ ثقةٍ. كلُّ توكيدٍ ههنا يقولُ «هذا ما تفعلُه الشِّفرةُ»،
 *   ولا يقولُ «وهذا صحيحٌ أمنياً».
 * الحالة: اختبارُ توصيفٍ (characterization) — يحرسُ المعرفةَ لا الصحّةَ.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: CI
 * الحاكم: `docs/evidence/security/XFF-TRUST-BOUNDARY-20260919.md`
 *
 * ## لِمَ ملفٌّ مستقلٌّ ولِمَ توصيفٌ لا إثباتٌ
 *
 * لأنَّ `tests/unit/rate-limit.test.ts` يحرسُ أنَّ **الحدَّ يحُدُّ**، وهذا الملفُّ
 * يحرسُ شيئاً آخرَ: **ما نعرفُه وما لا نعرفُه** عن مصدرِ العنوانِ. والخلطُ بينَهما
 * هوَ الذي يُنتِجُ الوهمَ: اختبارٌ أخضرُ على «أوّلُ قيمةٍ هيَ العميلُ» يُقرأُ بعدَ
 * شهرٍ كأنَّه **دليلُ نشرٍ**، وهوَ دليلُ تفكيكِ نصٍّ لا أكثرَ.
 *
 * ## وإذا سقطَ اختبارٌ من هذا الملفِّ
 *
 * فليسَ ذلكَ انحداراً بالضرورةِ — بل **تغيَّرت الدلالةُ**. والواجبُ حينَها تحديثُ
 * وثيقةِ حدِّ الثقةِ والملاحظتَينِ (أ) و(ب) فيها، لا إسكاتُ الاختبارِ. فهذا الملفُّ
 * يُلزِمُ أنَّ تغييرَ الدلالةِ يكونُ **قراراً معلوماً** لا انزلاقاً صامتاً.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يخترعُ عددَ قفزاتٍ موثوقةٍ** ولا `TRUSTED_PROXY_HOPS` ولا سياسةَ وسيطٍ.
 * - **لا يحكمُ** بأنَّ الأوّلَ أو الآخرَ هوَ الصوابُ: ذاكَ يقتضي طوبولوجيا نشرٍ
 *   مُثبَتةً، ولا نشرَ قائماً (`ADR 0099`).
 */
import { describe, expect, it } from "bun:test";
import type { RateDecision, RateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import {
  clientAddress,
  createTelegramWebhookRoutes,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";

const SECRET = "webhook-secret";
const WRONG_SECRET = "wrong-secret";
const UNAUTHORIZED = 401;
const TOO_MANY = 429;

/** حاصرٌ يسجّلُ **المفاتيحَ** — فالمقيسُ ههنا مفتاحُ العدِّ لا نتيجةُ العدِّ. */
function keyRecordingLimiter(limit: number): RateLimiter & { readonly keys: string[] } {
  const keys: string[] = [];
  const counts = new Map<string, number>();
  return {
    keys,
    hit(key: string): Promise<RateDecision> {
      keys.push(key);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve({
        allowed: next <= limit,
        remaining: Math.max(0, limit - next),
        resetSeconds: 60,
      });
    },
  };
}

function handlerDouble(seen: unknown[] = []) {
  return {
    seen,
    handle(update: unknown): Promise<boolean> {
      seen.push(update);
      return Promise.resolve(true);
    },
  };
}

function post(
  app: ReturnType<typeof createTelegramWebhookRoutes>,
  options: { readonly secret?: string; readonly address?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.secret !== undefined) headers["x-telegram-bot-api-secret-token"] = options.secret;
  if (options.address !== undefined) headers["x-forwarded-for"] = options.address;
  return Promise.resolve(
    app.fetch(
      new Request("http://localhost/webhook/telegram/driver", {
        method: "POST",
        headers,
        body: JSON.stringify({ message: { from: { id: 770 }, text: "/start" } }),
      }),
    ),
  );
}

describe("XFF — توصيفُ تفكيكِ الترويسةِ (code evidence لا deployment evidence)", () => {
  it("لا ترويسةَ ألبتّةَ ⇒ `unknown` — والتدهورُ مُسمّىً لا نصٌّ فارغٌ يخلطُ المفاتيحَ", () => {
    // ولِمَ يهمُّ: نصٌّ فارغٌ كانَ سيجمعُ **كلَّ** مَن لا ترويسةَ له في مفتاحٍ واحدٍ
    // بلا اسمٍ، فيُقرأُ الحدُّ كأنَّه على مُرسِلٍ واحدٍ وهوَ على جمهورٍ مجهولٍ.
    expect(clientAddress(undefined)).toBe("unknown");
    expect(clientAddress("")).toBe("unknown");
    expect(clientAddress("   ")).toBe("unknown");
    expect(clientAddress(",,")).toBe("unknown");
  });

  it("قيمةٌ واحدةٌ ⇒ تُردُّ كما هيَ بعدَ تشذيبِ الفراغِ", () => {
    expect(clientAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(clientAddress("  203.0.113.9  ")).toBe("203.0.113.9");
  });

  it("سلسلةٌ كما **يُلحِقُها** وسيطٌ ⇒ الشِّفرةُ تأخذُ **الأولى**، وهذا وصفٌ لا تصويبٌ", () => {
    // الصورةُ المُفترَضةُ في الإلحاقِ: `<ما قالَه العميلُ>, <ما رآه الوسيطُ>`.
    // فالشِّفرةُ تأخذُ الأولى — أي **ما قالَه العميلُ** في هذهِ الصورةِ.
    expect(clientAddress("203.0.113.9, 10.0.0.1, 10.0.0.2")).toBe("203.0.113.9");
    // ولو كانَ الوسيطُ الموثوقُ هوَ آخرُ حلقةٍ، لكانَ العنوانُ المرئيُّ له
    // `10.0.0.2` — والشِّفرةُ **لا تراه ولا تستطيعُ تمييزَه**. ويُثبَّتُ ذلكَ نصّاً
    // كي لا يُقرأَ الاختبارُ الأخضرُ إثباتاً لصوابِ الاختيارِ.
    expect(clientAddress("203.0.113.9, 10.0.0.1, 10.0.0.2")).not.toBe("10.0.0.2");
  });

  it("**عميلٌ يُرسِلُ الترويسةَ بنفسِه ⇒ تُقبَلُ بحرفِها**: لا تمييزَ بينَ منشأٍ ومُنتحَلٍ", () => {
    // هذا هوَ جوهرُ الملاحظةِ (ب). الشِّفرةُ تقرأُ **نصّاً** ولا تقرأُ **مَن كتبَه**:
    // لا مقابلةَ بعنوانِ المقبسِ، ولا عدَّ قفزاتٍ موثوقةٍ، ولا قائمةَ وسطاءَ.
    const spoofed = clientAddress("198.51.100.77");
    expect(spoofed).toBe("198.51.100.77");
    // وليسَ `unknown`: أي أنَّ ترويسةَ عميلٍ **غيرِ** موثوقٍ تُنتِجُ مفتاحاً صالحاً
    // تماماً كترويسةِ وسيطٍ موثوقٍ. **والاختبارُ الأخضرُ لا يُصحِّحُ ذلكَ** — إنّما
    // يُثبِّتُ أنَّ الشِّفرةَ اليومَ لا تملكُ ما تُميِّزُ به.
    expect(spoofed).not.toBe("unknown");
    // والقيمةُ ليست مُصادَقاً عليها شكلاً: نصٌّ ليسَ عنواناً يمرُّ مفتاحاً.
    expect(clientAddress("not-an-ip-at-all")).toBe("not-an-ip-at-all");
  });
});

describe("XFF × مسارُ ويبهوكِ تلغرام — مفتاحُ حاصرِ تخمينِ السرِّ", () => {
  it("فشلُ السرِّ ⇒ المفتاحُ `probe:<clientAddress>` مُشتَقٌّ من الترويسةِ", async () => {
    const probes = keyRecordingLimiter(5);
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes },
    });

    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      UNAUTHORIZED,
    );

    expect(probes.keys).toEqual(["probe:203.0.113.9"]);
  });

  it("سرٌّ صحيحٌ ⇒ لا يُحتسَبُ على حاصرِ التخمينِ شيءٌ (الحدُّ بعدَ الفشلِ لا قبلَه)", async () => {
    const probes = keyRecordingLimiter(5);
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes },
    });

    expect((await post(app, { secret: SECRET, address: "149.154.167.220" })).status).toBe(200);

    // ولولا ذلكَ لَخُنِقَت تلغرامُ نفسُها: تحديثاتُها من حزمةِ عناوينَ ضيّقةٍ.
    expect(probes.keys).toEqual([]);
  });

  it("**تدويرُ أوّلِ قيمةٍ ⇒ المفتاحُ يتغيَّرُ، فالحاصرُ لا يُغلَقُ** (توصيفٌ · الملاحظةُ أ)", async () => {
    // حدٌّ واحدٌ: أيُّ مفتاحٍ يُكرَّرُ مرّتَينِ يُقفَلُ عليه.
    const probes = keyRecordingLimiter(1);
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // أوّلُ قيمةٍ تُدوَّرُ، والباقي ثابتٌ كما لو أنَّ وسيطاً ألحقَ أثرَه.
      const header = `198.51.100.${i}, 10.0.0.1`;
      statuses.push((await post(app, { secret: WRONG_SECRET, address: header })).status);
    }

    // **ستُّ محاولاتٍ على سرٍّ خاطئٍ وحدُّ المحاولاتِ واحدةٌ — ولا إقفالَ ألبتّةَ.**
    expect(statuses).toEqual([
      UNAUTHORIZED,
      UNAUTHORIZED,
      UNAUTHORIZED,
      UNAUTHORIZED,
      UNAUTHORIZED,
      UNAUTHORIZED,
    ]);
    expect(statuses).not.toContain(TOO_MANY);
    // وستّةُ مفاتيحَ متمايزةٍ لا مفتاحٌ واحدٌ — فالعدُّ انقسمَ بأمرِ المُرسِلِ.
    expect(new Set(probes.keys).size).toBe(6);

    // **ولا يُقرأُ هذا الأخضرُ إقراراً بالصحّةِ.** هوَ توصيفٌ: مفتاحُ ضابطٍ أمنيٍّ
    // يختارُه صاحبُ الطلبِ ما لم يُثبَتْ حدُّ ثقةٍ يُعقِّمُ الترويسةَ. ويبقى السرُّ
    // نفسُه هوَ المانعَ الفعليَّ، وهذا الحاصرُ طبقةً يُعتمَدُ عليها ولم تُقَسْ.
  });

  it("سالبٌ (ح-7): مفتاحٌ **ثابتٌ** يُقفَلُ عليه — فالإقفالُ يعملُ والعطبُ في المفتاحِ", async () => {
    // ولولا هذا السالبِ لَجازَ أن يُقالَ إنَّ الحاصرَ معطوبٌ أصلاً، فيُنسَبَ العطبُ
    // إلى العدِّ وهوَ في **اشتقاقِ المفتاحِ**. فالتمييزُ مقيسٌ لا موصوفٌ.
    const probes = keyRecordingLimiter(1);
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes },
    });

    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      UNAUTHORIZED,
    );
    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      TOO_MANY,
    );
  });

  it("لا ترويسةَ ⇒ المفتاحُ `probe:unknown`: جمهورٌ مجهولٌ في دلوٍ واحدٍ", async () => {
    const probes = keyRecordingLimiter(5);
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes },
    });

    await post(app, { secret: WRONG_SECRET });

    // وهذا وجهٌ مقابلٌ للملاحظةِ (أ): حيثُ لا ترويسةَ يشتركُ الجميعُ في مفتاحٍ،
    // فيُقفَلُ على بريءٍ بفعلِ غيرِه. والوجهانِ من علّةٍ واحدةٍ: مصدرُ العنوانِ
    // غيرُ مُثبَتٍ، فلا الانقسامُ مضبوطٌ ولا الاجتماعُ.
    expect(probes.keys).toEqual(["probe:unknown"]);
  });
});
