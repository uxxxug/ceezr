/**
 * الغرض: اختبارُ المتحقِّقِ من `initData` الخام — القبولُ الصحيح، وكلُّ صنفِ رفضٍ
 *   ذكره البند `F1-03`، وعدمُ تسريبِ سرٍّ ولا مدخلٍ خامٍّ في ناتجِ الرفض.
 * الحالة: اختبار فعلي — لا شبكةَ ولا تيليجرامَ حقيقياً: توقيعٌ مُبنيٌّ محلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: القبولُ على جهازٍ حقيقيٍّ لا يُثبَت ههنا ولا يُدَّعى.
 */

import { describe, expect, it } from "bun:test";
import {
  createTelegramInitDataVerifier,
  dataCheckString,
  TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
} from "../../packages/infrastructure/identity/telegram-init-data.ts";
import {
  buildInitData,
  dropField,
  FAKE_DRIVER_BOT_TOKEN,
  FAKE_RIDER_BOT_TOKEN,
  SAMPLE_USER,
  tamperField,
} from "../support/telegram-init-data.ts";

const NOW_SECONDS = 1_800_000_000;

function verifier(overrides: { maxAgeSeconds?: number } = {}) {
  return createTelegramInitDataVerifier({
    bots: [
      { name: "driver", token: FAKE_DRIVER_BOT_TOKEN },
      { name: "rider", token: FAKE_RIDER_BOT_TOKEN },
    ],
    ...(overrides.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: overrides.maxAgeSeconds }),
  });
}

function validInitData(extra: Partial<Parameters<typeof buildInitData>[0]> = {}): string {
  return buildInitData({
    botToken: FAKE_DRIVER_BOT_TOKEN,
    authDateSeconds: NOW_SECONDS - 10,
    user: SAMPLE_USER,
    queryId: "AAH-test-query",
    ...extra,
  });
}

function reasonOf(result: ReturnType<ReturnType<typeof verifier>["verify"]>): string {
  return result.ok ? "OK" : result.error.reason;
}

describe("سلسلة الفحص", () => {
  it("تستثني hash وحدَه وترتّب أبجدياً بفاصل سطر", () => {
    const built = dataCheckString([
      ["user", "{}"],
      ["hash", "deadbeef"],
      ["auth_date", "5"],
      ["signature", "sig"],
    ]);
    expect(built).toBe("auth_date=5\nsignature=sig\nuser={}");
  });
});

describe("initData صالح", () => {
  it("يُقبَل ويُعيد إثباتاً من الحقول الموقَّعة وحدها", () => {
    const result = verifier().verify(validInitData(), NOW_SECONDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("توقّعنا قبولاً");
    expect(result.value.telegramUserId).toBe(String(SAMPLE_USER.id));
    expect(result.value.bot).toBe("driver");
    expect(result.value.authDateSeconds).toBe(NOW_SECONDS - 10);
    expect(result.value.username).toBe("noura_test");
    expect(result.value.firstName).toBe("نورة");
    expect(result.value.languageCode).toBe("ar");
    expect(result.value.isPremium).toBeUndefined();
  });

  it("يُقبَل الموقَّعُ ببوتِ الراكب ويُسمّى موقِّعُه بدقّة", () => {
    const result = verifier().verify(
      validInitData({ botToken: FAKE_RIDER_BOT_TOKEN }),
      NOW_SECONDS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("توقّعنا قبولاً");
    expect(result.value.bot).toBe("rider");
  });

  it("يُقبَل مع حقلِ signature ويُدرَج في سلسلةِ الفحصِ لا يُستثنى", () => {
    const withSignature = validInitData({ signature: "ZmFrZS1zaWduYXR1cmU" });
    expect(verifier().verify(withSignature, NOW_SECONDS).ok).toBe(true);
    // ولو استُثني `signature` من سلسلةِ الفحصِ لصار حذفُه بعد التوقيع مقبولاً:
    expect(reasonOf(verifier().verify(dropField(withSignature, "signature"), NOW_SECONDS))).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it("يمرّر start_param كما وُقّع، ولا يفسّره", () => {
    const result = verifier().verify(validInitData({ startParam: "ride_42" }), NOW_SECONDS);
    if (!result.ok) throw new Error("توقّعنا قبولاً");
    expect(result.value.startParam).toBe("ride_42");
  });

  it("يُقبَل بحقولٍ إضافيةٍ لا نعرفها بشرط أن تكون موقَّعة", () => {
    expect(
      verifier().verify(validInitData({ extra: { chat_type: "private" } }), NOW_SECONDS).ok,
    ).toBe(true);
  });

  it("يقبل is_premium الموقَّعة", () => {
    const result = verifier().verify(
      validInitData({ user: { ...SAMPLE_USER, is_premium: true } }),
      NOW_SECONDS,
    );
    if (!result.ok) throw new Error("توقّعنا قبولاً");
    expect(result.value.isPremium).toBe(true);
  });
});

describe("رفض التوقيع", () => {
  it("يرفض hash لا يطابق", () => {
    const bad = validInitData({ overrideHash: "a".repeat(64) });
    expect(reasonOf(verifier().verify(bad, NOW_SECONDS))).toBe("SIGNATURE_MISMATCH");
  });

  it("يرفض العبثَ ببيانات المستخدم بعد التوقيع", () => {
    const tampered = tamperField(
      validInitData(),
      "user",
      JSON.stringify({ ...SAMPLE_USER, id: 999 }),
    );
    expect(reasonOf(verifier().verify(tampered, NOW_SECONDS))).toBe("SIGNATURE_MISMATCH");
  });

  it("يرفض العبثَ بـauth_date بعد التوقيع", () => {
    const tampered = tamperField(validInitData(), "auth_date", String(NOW_SECONDS));
    expect(reasonOf(verifier().verify(tampered, NOW_SECONDS))).toBe("SIGNATURE_MISMATCH");
  });

  it("يرفض إضافةَ حقلٍ لم يُوقَّع", () => {
    const tampered = tamperField(validInitData(), "role", "admin");
    expect(reasonOf(verifier().verify(tampered, NOW_SECONDS))).toBe("SIGNATURE_MISMATCH");
  });

  it("يرفض رمزَ بوتٍ آخر غير المُهيَّأ", () => {
    const other = validInitData({ botToken: "333333:CC-unknown-bot-token" });
    expect(reasonOf(verifier().verify(other, NOW_SECONDS))).toBe("SIGNATURE_MISMATCH");
  });

  it("يرفض قبل التحقّق حين لا بوتَ مُهيَّأً — لا يقبل تسامحاً", () => {
    const empty = createTelegramInitDataVerifier({ bots: [{ name: "driver", token: "" }] });
    const result = empty.verify(validInitData(), NOW_SECONDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("توقّعنا رفضاً");
    expect(result.error.reason).toBe("NO_SIGNING_BOT_CONFIGURED");
  });
});

describe("رفض الشكل", () => {
  it("يرفض النصَّ الفارغَ والمسافات", () => {
    expect(reasonOf(verifier().verify("", NOW_SECONDS))).toBe("EMPTY");
    expect(reasonOf(verifier().verify("   ", NOW_SECONDS))).toBe("EMPTY");
  });

  it("يرفض نصاً مشوَّهاً لا يحمل حقولاً معروفة", () => {
    expect(reasonOf(verifier().verify("%%%not-a-query%%%", NOW_SECONDS))).toBe("HASH_MISSING");
    expect(reasonOf(verifier().verify("=", NOW_SECONDS))).toBe("HASH_MISSING");
  });

  it("يرفض غيابَ hash", () => {
    expect(reasonOf(verifier().verify(validInitData({ omitHash: true }), NOW_SECONDS))).toBe(
      "HASH_MISSING",
    );
  });

  it("يرفض hash مكرَّراً — لا يختار أحدَهما", () => {
    const duplicated = `${validInitData()}&hash=${"b".repeat(64)}`;
    expect(reasonOf(verifier().verify(duplicated, NOW_SECONDS))).toBe("HASH_DUPLICATED");
  });

  it("يرفض hash بصيغةٍ ليست سِتّ عشريّةً بطولٍ صحيح", () => {
    expect(reasonOf(verifier().verify(validInitData({ overrideHash: "zz" }), NOW_SECONDS))).toBe(
      "MALFORMED",
    );
    expect(
      reasonOf(verifier().verify(validInitData({ overrideHash: "A".repeat(64) }), NOW_SECONDS)),
    ).toBe("MALFORMED");
  });

  it("يرفض غيابَ auth_date وتشويهَها", () => {
    const noAuthDate = dropField(validInitData(), "auth_date");
    expect(reasonOf(verifier().verify(noAuthDate, NOW_SECONDS))).toBe("AUTH_DATE_MISSING");
    expect(
      reasonOf(verifier().verify(tamperField(validInitData(), "auth_date", "غداً"), NOW_SECONDS)),
    ).toBe("AUTH_DATE_MALFORMED");
    expect(
      reasonOf(verifier().verify(tamperField(validInitData(), "auth_date", "-5"), NOW_SECONDS)),
    ).toBe("AUTH_DATE_MALFORMED");
    expect(
      reasonOf(verifier().verify(tamperField(validInitData(), "auth_date", "1e9"), NOW_SECONDS)),
    ).toBe("AUTH_DATE_MALFORMED");
  });

  it("يرفض غيابَ المستخدم بعد توقيعٍ صحيح", () => {
    const noUser = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 5,
      user: null,
      queryId: "AAH-no-user",
    });
    expect(reasonOf(verifier().verify(noUser, NOW_SECONDS))).toBe("USER_MISSING");
  });

  it("يرفض مستخدماً موقَّعاً لكنّ بنيتَه غيرُ صالحة", () => {
    const notJson = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 5,
      extra: { user: "ليس JSON" },
    });
    expect(reasonOf(verifier().verify(notJson, NOW_SECONDS))).toBe("USER_MALFORMED");

    const noId = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 5,
      extra: { user: JSON.stringify({ first_name: "بلا معرّف" }) },
    });
    expect(reasonOf(verifier().verify(noId, NOW_SECONDS))).toBe("USER_MALFORMED");

    const textId = buildInitData({
      botToken: FAKE_DRIVER_BOT_TOKEN,
      authDateSeconds: NOW_SECONDS - 5,
      extra: { user: JSON.stringify({ id: "8100200300" }) },
    });
    expect(reasonOf(verifier().verify(textId, NOW_SECONDS))).toBe("USER_MALFORMED");
  });
});

describe("سياسة الصلاحية", () => {
  it("يقبل عند حدّ النافذة بالضبط ويرفض بعده بثانية", () => {
    const atLimit = validInitData({
      authDateSeconds: NOW_SECONDS - TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
    });
    expect(verifier().verify(atLimit, NOW_SECONDS).ok).toBe(true);

    const past = validInitData({
      authDateSeconds: NOW_SECONDS - TELEGRAM_INIT_DATA_MAX_AGE_SECONDS - 1,
    });
    expect(reasonOf(verifier().verify(past, NOW_SECONDS))).toBe("AUTH_DATE_STALE");
  });

  it("يرفض إثباتاً قديماً ولو كان توقيعُه صحيحاً تماماً", () => {
    const old = validInitData({ authDateSeconds: NOW_SECONDS - 86_400 });
    expect(reasonOf(verifier().verify(old, NOW_SECONDS))).toBe("AUTH_DATE_STALE");
  });

  it("يتسامح مع انحرافِ ساعةٍ محدودٍ ويرفض ما زاد عليه", () => {
    const skewed = validInitData({
      authDateSeconds: NOW_SECONDS + TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS,
    });
    expect(verifier().verify(skewed, NOW_SECONDS).ok).toBe(true);

    const future = validInitData({
      authDateSeconds: NOW_SECONDS + TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS + 1,
    });
    expect(reasonOf(verifier().verify(future, NOW_SECONDS))).toBe("AUTH_DATE_IN_FUTURE");
  });

  it("النافذةُ قابلةٌ للتضييق بالحقن ولا تُقرأ من ساعةِ العالم", () => {
    const strict = verifier({ maxAgeSeconds: 5 });
    expect(strict.verify(validInitData({ authDateSeconds: NOW_SECONDS - 4 }), NOW_SECONDS).ok).toBe(
      true,
    );
    expect(
      reasonOf(strict.verify(validInitData({ authDateSeconds: NOW_SECONDS - 6 }), NOW_SECONDS)),
    ).toBe("AUTH_DATE_STALE");
  });

  it("إثباتٌ صالحٌ يبقى مقبولاً مكرّراً داخل نافذته — سياسةٌ معلَنة لا سهو", () => {
    // البند لا يوجب مخزنَ استعمالٍ لمرّةٍ واحدة، وتيليجرام لا يمنح nonce يُخزَّن.
    // فالتكرارُ داخل النافذةِ مقبولٌ، والحدُّ عليه نافذةُ الخمسِ دقائقِ وحدُّ المعدّل.
    const data = validInitData();
    expect(verifier().verify(data, NOW_SECONDS).ok).toBe(true);
    expect(verifier().verify(data, NOW_SECONDS + 1).ok).toBe(true);
  });
});

describe("عدم التسريب", () => {
  it("ناتجُ الرفضِ لا يحمل المدخلَ الخامَّ ولا hash ولا رمزَ بوت", () => {
    const bad = validInitData({ overrideHash: "c".repeat(64) });
    const result = verifier().verify(bad, NOW_SECONDS);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("c".repeat(64));
    expect(serialised).not.toContain("auth_date");
    expect(serialised).not.toContain(FAKE_DRIVER_BOT_TOKEN);
    expect(serialised).not.toContain("noura_test");
    expect(serialised).toBe(
      JSON.stringify({
        ok: false,
        error: { code: "TELEGRAM_PROOF_REJECTED", reason: "SIGNATURE_MISMATCH" },
      }),
    );
  });

  it("الإثباتُ المقبولُ لا يحمل رمزَ البوتِ ولا التوقيع", () => {
    const result = verifier().verify(validInitData({ signature: "c2ln" }), NOW_SECONDS);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(FAKE_DRIVER_BOT_TOKEN);
    expect(serialised).not.toContain("c2ln");
    expect(serialised).toContain("driver");
  });
});
