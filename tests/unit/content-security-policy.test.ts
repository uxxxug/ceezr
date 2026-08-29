/**
 * الغرض: تثبيتُ **نصِّ** سياسةِ المحتوى حرفاً حرفاً، وتثبيتُ ما لا تُصدِره الوحدةُ
 *   أبداً. والبند `F1-10` قيمتُه في النصِّ لا في وجودِ وسمٍ: `'unsafe-inline'`
 *   واحدةٌ تُبقي الوسمَ موجوداً والسياسةَ بلا معنى، وحاجزُ CI يقارن مُخرَجَ البناءِ
 *   بمُخرَجِ هذه الدالّةِ — فإن انحدرت الدالّةُ انحدر الحاجزُ معها بصمتٍ وبقيَ أخضرَ.
 *   فههنا تُقيَّد القيمةُ المتوقَّعةُ صريحةً لا مُشتقّةً من الدالّةِ نفسِها.
 * الحالة: منفّذ فعلياً — البند `F1-10`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على القائمةِ المغلقةِ أو على التوجيهاتِ —
 *   وأيُّ توسيعٍ يجب أن يُسقِط هذا الملفَّ أوّلاً فيُقرأ عن قصدٍ لا عن سهوٍ.
 * ملاحظات مستقبلية: حين يُحسَم شأنُ MapLibre (ADR 0045 §٦) يتغيّر عددُ النطاقاتِ
 *   المأذونِ لها، فيتغيّر هذا الملفُّ **ومعه ADR** لأنّ القرارَ يُنقَض لا يُوسَّع.
 *
 * وما لا يفعله هذا الملفُّ: **لا يُشغِّل متصفّحاً**. فلا يُثبِت أنّ المتصفّحَ يُطبِّق
 * السياسةَ فعلاً ولا أنّ التطبيقَ يعمل تحتَها — يُثبِت أنّ النصَّ هو المقصودُ. والدليلُ
 * السلوكيُّ يبقى ناقصاً ومُعلَناً في `docs/evidence/architecture/F1-10-20260829.md` §٣.
 */

import { describe, expect, it } from "bun:test";
import {
  ALLOWED_EXTERNAL_ORIGIN_LIST,
  ALLOWED_EXTERNAL_ORIGINS,
  buildCsp,
  cspMetaTag,
  originOf,
  SOLE_EXTERNAL_SCRIPT_HOST_FILE,
} from "../../scripts/lib/content-security-policy.ts";

/** بصمةٌ ثابتةٌ مصنوعةٌ: القيمةُ لا تهمّ، موضعُها في النصِّ يهمّ. */
const HASH_A = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='";
const HASH_B = "'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='";

describe("القائمةُ المغلقةُ للنطاقاتِ الخارجيةِ", () => {
  it("فيها نطاقٌ واحدٌ بالضبطِ وهو تلغرام", () => {
    expect(ALLOWED_EXTERNAL_ORIGIN_LIST).toEqual(["https://telegram.org"]);
  });

  it("كلُّ نطاقٍ فيها له سندٌ مكتوبٌ غيرُ فارغٍ", () => {
    for (const origin of ALLOWED_EXTERNAL_ORIGIN_LIST) {
      const justification = ALLOWED_EXTERNAL_ORIGINS[origin];
      expect(typeof justification).toBe("string");
      expect((justification ?? "").trim().length).toBeGreaterThan(40);
    }
  });

  it("لا تُعدَّل في زمنِ التشغيلِ: مُجمَّدةٌ", () => {
    expect(Object.isFrozen(ALLOWED_EXTERNAL_ORIGINS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_EXTERNAL_ORIGIN_LIST)).toBe(true);
  });

  it("الموضعُ الوحيدُ المأذونُ له بحملِ مصدرٍ خارجيٍّ هو مستندُ التطبيقِ", () => {
    expect(SOLE_EXTERNAL_SCRIPT_HOST_FILE).toBe("apps/miniapp/index.html");
  });
});

describe("originOf", () => {
  it("يستخرج الأصلَ من عنوانٍ كاملٍ ويطرح المسارَ", () => {
    expect(originOf("https://api.example.com/v1/rides?x=1")).toBe("https://api.example.com");
  });

  it("يُبقي المنفذَ لأنّه جزءٌ من الأصلِ", () => {
    expect(originOf("http://localhost:8787/v1")).toBe("http://localhost:8787");
  });

  it("يُرجِع null للفراغِ وللغائبِ", () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf("   ")).toBeNull();
  });

  it("يُرجِع null للعنوانِ النسبيِّ: لا أصلَ له فلا يُضاف إلى السياسةِ", () => {
    expect(originOf("/v1")).toBeNull();
    expect(originOf("v1/rides")).toBeNull();
  });

  it("يُرجِع null للمُشوَّهِ بدلَ أن يرمي: حاجزٌ لا يسقط بخطأٍ غيرِ مفهومٍ", () => {
    expect(originOf("https://")).toBeNull();
    expect(originOf("::::")).toBeNull();
  });
});

describe("buildCsp — النصُّ المتوقَّعُ حرفاً حرفاً", () => {
  it("بلا حدِّ API خارجيٍّ: connect-src هو 'self' وحدَه", () => {
    expect(buildCsp({ inlineStyleHashes: [HASH_A] })).toBe(
      "default-src 'none'; " +
        "script-src 'self' https://telegram.org; " +
        `style-src 'self' ${HASH_A}; ` +
        "img-src 'self' data:; " +
        "connect-src 'self'; " +
        "base-uri 'none'; " +
        "form-action 'none'; " +
        "object-src 'none'; " +
        "frame-src 'none'; " +
        "child-src 'none'",
    );
  });

  it("مع حدِّ API خارجيٍّ: يُضاف أصلُه وحدَه إلى connect-src لا إلى غيرِه", () => {
    const policy = buildCsp({
      apiBase: "https://api.waslah.example/v1/",
      inlineStyleHashes: [HASH_A],
    });
    expect(policy).toContain("connect-src 'self' https://api.waslah.example;");
    expect(policy).toContain("script-src 'self' https://telegram.org;");
    /** الأصلُ لا يتسرّب إلى توجيهٍ آخرَ: حدُّ API يُتَّصَل به ولا يُنفَّذ منه شيءٌ. */
    expect(policy).not.toContain("script-src 'self' https://telegram.org https://api");
    expect(policy.match(/https:\/\/api\.waslah\.example/g)).toHaveLength(1);
  });

  it("حدُّ API نسبيٌّ أو فارغٌ لا يُغيِّر شيئاً", () => {
    const base = buildCsp({ inlineStyleHashes: [HASH_A] });
    expect(buildCsp({ apiBase: "/v1", inlineStyleHashes: [HASH_A] })).toBe(base);
    expect(buildCsp({ apiBase: "", inlineStyleHashes: [HASH_A] })).toBe(base);
  });

  it("بصماتٌ متعددةٌ تُدرَج كلُّها بترتيبِ ورودِها", () => {
    expect(buildCsp({ inlineStyleHashes: [HASH_A, HASH_B] })).toContain(
      `style-src 'self' ${HASH_A} ${HASH_B};`,
    );
  });

  it("بلا بصماتٍ: style-src يبقى 'self' ولا يفتح 'unsafe-inline' تعويضاً", () => {
    const policy = buildCsp({ inlineStyleHashes: [] });
    expect(policy).toContain("style-src 'self';");
    expect(policy).not.toContain("unsafe-inline");
  });
});

describe("buildCsp — ما لا يُصدَر أبداً", () => {
  const inputs = [
    { inlineStyleHashes: [] },
    { inlineStyleHashes: [HASH_A] },
    { apiBase: "https://api.waslah.example", inlineStyleHashes: [HASH_A, HASH_B] },
    { apiBase: "/v1", inlineStyleHashes: [HASH_B] },
  ];

  /**
   * `frame-ancestors` مقصودٌ بالغيابِ لا بالسهوِ: المعيارُ يُلغيه في `<meta>`، ولو
   * عمل لكسر تضمينَ تلغرامَ نفسَه. وموضعُه رأسُ استجابةٍ ولا مضيفَ بعدُ (ADR 0045 §٥).
   */
  for (const forbidden of [
    "unsafe-inline",
    "unsafe-eval",
    "unsafe-hashes",
    "strict-dynamic",
    "nonce-",
    "frame-ancestors",
    "report-uri",
    "http://",
    "*",
  ]) {
    it(`لا يُصدِر «${forbidden}» في أيِّ دخلٍ`, () => {
      for (const input of inputs) expect(buildCsp(input)).not.toContain(forbidden);
    });
  }

  it("كلُّ توجيهٍ يظهر مرّةً واحدةً: توجيهٌ مكرَّرٌ يُهمَل ثانيهِ فتُصبِح السياسةُ غامضةً", () => {
    for (const input of inputs) {
      const names = buildCsp(input)
        .split("; ")
        .map((directive) => directive.split(" ")[0]);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("لا فاصلةَ منقوطةً خاتمةً ولا مسافةَ زائدةً: الحاجزُ يقارن نصّاً", () => {
    for (const input of inputs) {
      const policy = buildCsp(input);
      expect(policy.endsWith(";")).toBe(false);
      expect(policy.trim()).toBe(policy);
    }
  });
});

describe("cspMetaTag", () => {
  it("يُنتِج وسماً مغلقاً بالسياسةِ نفسِها", () => {
    expect(cspMetaTag("default-src 'none'")).toBe(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />',
    );
  });

  it("لا يستعمل علامةَ اقتباسٍ مزدوجةً داخلَ المحتوى فتُغلَق السمةُ باكراً", () => {
    const tag = cspMetaTag(buildCsp({ inlineStyleHashes: [HASH_A] }));
    expect(tag.match(/"/g)).toHaveLength(4);
  });
});
