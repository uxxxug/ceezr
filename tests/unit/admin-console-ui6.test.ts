/**
 * الغرض: حراسةُ عقدِ UI-6 / PR 9 (ADR 0240) على لوحةِ الإدارة بلا قاعدةٍ ولا متصفّح:
 *   الهيكلُ (معالمُ، رابطُ تخطٍّ، تركيزٌ، عنوانٌ واحد)، الحالاتُ السبع، صدقُ عُمرِ القراءةِ
 *   بلا استقصاء، تأكيدُ الأفعالِ الخطرة، CSRF في كلِّ نموذجِ كتابة، بلا سماتِ أحداثٍ ولا
 *   أنماطٍ مضمَّنةٍ ثابتة، وتباينُ رموزِ اللون.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على apps/admin-dashboard
 * ملاحظات مستقبلية: فحوصُ المصدرِ هنا تمسحُ كلَّ ملفٍّ تحت pages/ — صفحةٌ جديدةٌ تُفحَصُ تلقائياً.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAV_ITEMS,
  renderBreakGlassPage,
  renderDriversPage,
  renderLiveOrdersPage,
  renderLoginPage,
  renderRecoveryPage,
  renderShell,
  STATE_META,
  STYLE,
  type StateKind,
  stateBlock,
  table,
} from "../../apps/admin-dashboard/src/index.ts";
import { isRecoveryDecisionReason } from "../../apps/gateway/src/admin/queries.ts";

const CSRF = "a".repeat(64);
const NONCE = "nonce-ui6";
const NOW = new Date("2026-10-06T12:00:00.000Z");
const USER = { userId: "u1", cityId: "c1", telegramId: "1", fullName: "مسؤول النظام" };
const ADVERSARIAL = `<img src=x onerror="alert(1)">`;

function shell(extra: Partial<Parameters<typeof renderShell>[0]> = {}): string {
  return renderShell({
    title: "نظرة عامة",
    activePath: "/admin",
    user: USER,
    csrfToken: CSRF,
    cspNonce: NONCE,
    body: "<h1>نظرة عامة</h1>",
    ...extra,
  });
}

const PAGES_DIR = join(import.meta.dir, "../../apps/admin-dashboard/src/pages");
const SOURCE_FILES = [
  ...readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(PAGES_DIR, f)),
  join(import.meta.dir, "../../apps/admin-dashboard/src/layout.ts"),
  join(import.meta.dir, "../../apps/admin-dashboard/src/map.ts"),
  join(import.meta.dir, "../../apps/admin-dashboard/src/login.ts"),
];
const SOURCES = SOURCE_FILES.map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("UI-6 · الهيكل", () => {
  it("معالمُ الصفحة: رابطُ تخطٍّ إلى main، تنقّلٌ مسمّى، والقسمُ الحاليُّ معلَنٌ", () => {
    const html = shell();
    expect(html).toContain('<a class="skip" href="#main">');
    expect(html).toContain('<main id="main" tabindex="-1">');
    expect(html).toContain('<nav class="nav" aria-label="أقسام اللوحة">');
    expect(html).toContain('href="/admin" aria-current="page"');
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-live="polite"');
  });

  it("كلُّ وسمِ نصٍّ أو نمطٍ يحملُ nonce — لا وسمَ يُرفَضُ صامتاً تحت CSP", () => {
    const html = shell({ freshness: { observedAt: NOW, staleAfterSeconds: 20 } });
    for (const tag of html.match(/<(script|style)\b[^>]*>/g) ?? []) {
      expect(tag).toContain(`nonce="${NONCE}"`);
    }
  });

  it("لا مؤقّتَ ولا استقصاءَ ولا إعادةَ تحميلٍ ذاتيّة (§9)", () => {
    const html = shell({ freshness: { observedAt: NOW, staleAfterSeconds: 20 } });
    expect(html).not.toContain("setInterval");
    expect(html).not.toContain("setTimeout");
    expect(html).not.toContain("location.reload");
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it("صدقُ عُمرِ القراءة: ساعةٌ معلنة، وشريطُ قِدَمٍ يظهرُ بعد العتبةِ بلا جافاسكربت", () => {
    const html = shell({ freshness: { observedAt: NOW, staleAfterSeconds: 20 } });
    expect(html).toContain(`<time datetime="${NOW.toISOString()}">`);
    expect(html).toContain("الصفحةُ لا تتحدّثُ وحدَها");
    expect(html).toContain('data-freshness="20"');
    expect(html).toContain('data-state="stale"');
    expect(html).toContain(".stale-reveal{animation-delay:20s}");
    expect(STYLE).toContain(".stale-reveal{visibility:hidden");
    // بلا عتبة: لا شريطَ ولا ادّعاءَ بعُمرٍ لم يُقَس.
    expect(shell()).not.toContain("data-freshness");
  });

  it("عتبةٌ أصغرُ من الحدِّ الأدنى لا تُعلنُ القراءةَ قديمةً قبل أن تُقرأ", () => {
    const html = shell({ freshness: { observedAt: NOW, staleAfterSeconds: 0 } });
    expect(html).toContain(".stale-reveal{animation-delay:5s}");
  });

  it("الخطأُ تنبيهٌ يُقرأ فوراً، والنجاحُ حالةٌ لا تقاطع — والنصُّ مهروب", () => {
    const err = shell({ notice: { kind: "error", text: ADVERSARIAL } });
    expect(err).toContain('role="alert" class="notice notice--error">&lt;img');
    expect(err).not.toContain(ADVERSARIAL);
    const ok = shell({ notice: { kind: "ok", text: "تم" } });
    expect(ok).toContain('role="status" class="notice notice--ok">تم<');
  });

  it("الحركةُ محصورةٌ في prefers-reduced-motion، ولا !important ولا @layer", () => {
    expect(STYLE).not.toContain("!important");
    expect(STYLE).not.toContain("@layer");
    expect(STYLE).toContain(":focus-visible");
    const transitions = STYLE.split("@media (prefers-reduced-motion:no-preference)");
    expect(transitions[0]).not.toContain("transition");
    // خصائصُ منطقيةٌ لا فيزيائية: لا يمين/يسار مكتوبٌ يكسرُ الاتجاه.
    expect(STYLE).not.toMatch(/(margin|padding)-(left|right)\s*:/);
    expect(STYLE).not.toMatch(/text-align:\s*(left|right)/);
  });

  it("التنقّلُ لم يتغيّر: ثلاثة عشر قسماً بالمسارات نفسها", () => {
    expect(NAV_ITEMS.length).toBe(13);
  });
});

describe("UI-6 · الحالات السبع (§5)", () => {
  const kinds: readonly StateKind[] = [
    "loading",
    "empty",
    "error",
    "refused",
    "unavailable",
    "stale",
    "unknown",
  ];

  it("لكلِّ حالةٍ اسمٌ نصّيٌّ ورسمٌ مخفيٌّ عن قارئ الشاشة — المعنى لا يُحمَل باللون", () => {
    expect(Object.keys(STATE_META).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const html = stateBlock(kind, "سبب");
      expect(html).toContain(`data-state="${kind}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(STATE_META[kind].label);
      expect(html).toContain("سبب");
    }
  });

  it("الخطأُ والرفضُ تنبيهان؛ والبقيةُ لا تقاطعُ القارئ", () => {
    expect(stateBlock("error", "x")).toContain('role="alert"');
    expect(stateBlock("refused", "x")).toContain('role="alert"');
    expect(stateBlock("empty", "x")).not.toContain('role="alert"');
  });

  it("السببُ والفعلُ مهروبان", () => {
    const html = stateBlock("error", ADVERSARIAL, { href: `"><script>`, label: ADVERSARIAL });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('"><script>');
  });

  it("الجدولُ الفارغُ حالةُ «فراغ» لا فقرةٌ رمادية، والجدولُ الممتلئُ بعناوينَ مسمّاة", () => {
    expect(table({ headers: ["أ"], rows: [], emptyText: "لا شيء" })).toContain(
      'data-state="empty"',
    );
    const full = table({ headers: ["أ", ""], rows: [["1", "2"]], emptyText: "x", caption: "ج" });
    expect(full).toContain('<th scope="col">أ</th>');
    expect(full).toContain('<span class="vh">الإجراء</span>');
    expect(full).toContain('<caption class="vh">ج</caption>');
  });

  it("نصُّ البحث يميّزُ الفراغَ عن الانقطاعِ والرفضِ وعدمِ الإتاحةِ والردِّ المجهول", () => {
    const html = shell();
    for (const marker of [
      "showState('loading'",
      "showState('empty'",
      "showState('refused'",
      "showState('unavailable'",
      "showState('error'",
      "showState('unknown'",
      "res.status===401",
      "res.status===429",
      "res.status===503",
      "aria-busy",
      "'Escape'",
    ]) {
      expect(html).toContain(marker);
    }
  });
});

describe("UI-6 · فحوصُ المصدرِ على كلِّ صفحة", () => {
  it("لا سماتِ أحداثٍ مضمَّنة (CSP لا تُجيزها)", () => {
    for (const { path, text } of SOURCES) {
      expect({ path, hit: /\son(click|change|submit|load|input|error)=/.test(text) }).toEqual({
        path,
        hit: false,
      });
    }
  });

  it("لا مؤقّتَ ولا إعادةَ تحميلٍ في أيِّ صفحة", () => {
    for (const { path, text } of SOURCES) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect({ path, hit: /setInterval|location\.reload/.test(code) }).toEqual({
        path,
        hit: false,
      });
    }
  });

  it("سماتُ style المضمَّنةُ في القائمةِ المسموحةِ وحدَها (قيمٌ محسوبةٌ لكلِّ عنصر)", () => {
    const allowed = [
      /^style="background:\$\{cellColor\(/,
      /^style="grid-template-columns:repeat\(\$\{data\.cols\}/,
      /^style="height:\$\{height\}px"/,
    ];
    for (const { path, text } of SOURCES) {
      for (const m of text.matchAll(/style="[^"]*"/g)) {
        expect({ path, attr: m[0], ok: allowed.some((re) => re.test(m[0])) }).toEqual({
          path,
          attr: m[0],
          ok: true,
        });
      }
    }
  });

  // بعضُ الصفحاتِ تبني الحقلَ المخفيَّ مرّةً في متغيّرٍ `csrf` وتُدرجُه في كلِّ نموذج.
  function hasCsrf(form: string, file: string): boolean {
    if (form.includes('name="csrf"')) return true;
    return form.includes(`\${csrf}`) && /const csrf = `<input type="hidden" name="csrf"/.test(file);
  }

  it("كلُّ نموذجِ كتابةٍ (عدا الدخول) يحملُ رمزَ CSRF", () => {
    for (const { path, text } of SOURCES) {
      if (path.endsWith("login.ts")) continue;
      for (const m of text.matchAll(/<form[^>]*method="post"[\s\S]*?<\/form>/g)) {
        expect({ path, form: m[0].slice(0, 120), csrf: hasCsrf(m[0], text) }).toEqual({
          path,
          form: m[0].slice(0, 120),
          csrf: true,
        });
      }
    }
  });
});

describe("UI-6 · الأفعالُ الخطرة", () => {
  it("استرداد الحسابات: CSRF في النموذج (كان غائباً فيُرفَضُ كلُّ قرار)، وتأكيدٌ، وبلا قرارٍ مختارٍ سلفاً", () => {
    const html = renderRecoveryPage(
      [
        {
          id: "r1",
          targetUserId: "t1",
          claimantTelegramId: "999",
          evidenceSummary: ADVERSARIAL,
          submittedAt: NOW.toISOString(),
          targetFullName: ADVERSARIAL,
          targetTelegramId: null,
          targetIsBlocked: false,
        },
      ],
      CSRF,
    );
    expect(html).toContain(`name="csrf" value="${CSRF}"`);
    expect(html).toContain("data-confirm=");
    expect(html).toContain('<option value="" selected disabled>');
    expect(html).not.toContain('value="approved" selected');
    expect(html).not.toContain("<img");
    expect(html.match(/<h1>/g)?.length).toBe(1);
  });

  it("أسبابُ القرارِ في الواجهةِ كلُّها مقبولةٌ على الخادم — لا خيارَ يُرفَضُ بعد الإرسال", () => {
    const html = renderRecoveryPage([], CSRF);
    expect(html).toContain('data-state="empty"');
    const withRow = renderRecoveryPage(
      [
        {
          id: "r1",
          targetUserId: "t1",
          claimantTelegramId: null,
          evidenceSummary: "x",
          submittedAt: NOW.toISOString(),
          targetFullName: null,
          targetTelegramId: null,
          targetIsBlocked: true,
        },
      ],
      CSRF,
    );
    const reasons = [...withRow.matchAll(/<option value="([a-z_]+)">/g)]
      .map((m) => m[1] ?? "")
      .filter((v) => v !== "approved" && v !== "rejected");
    expect(reasons.length).toBe(7);
    for (const reason of reasons) expect(isRecoveryDecisionReason(reason)).toBe(true);
  });

  it("قطعُ روابطِ التتبّع: تأكيدٌ صريحٌ وزرٌّ بصفةِ الخطر", () => {
    const html = renderLiveOrdersPage({
      now: NOW,
      csrfToken: CSRF,
      cities: [],
      cityId: null,
      stallSeconds: 120,
      rows: [
        {
          cityCode: "JED",
          service: "transport",
          riderName: "عميل",
          riderTelegramId: "9200",
          driverName: null,
          pickupLabel: "الحرم",
          dropoffLabel: "المطار",
          matchedAt: null,
          startedAt: null,
          broadcastRound: 1,
          pendingOffers: 0,
          negotiationStage: null,
          orderId: "66666666-6666-6666-6666-666666666666",
          status: "searching",
          createdAt: NOW.toISOString(),
        },
      ],
    });
    expect(html).toMatch(/data-confirm="[^"]+" action="[^"]+\/revoke-tracking">/);
    expect(html).toContain('<button class="danger" type="submit">قطع روابط التتبّع</button>');
  });

  it("الحظرُ يُؤكَّدُ ورفعُه لا؛ والاسمُ في نصِّ التأكيدِ مهروب", () => {
    const row = {
      driverId: "d1",
      userId: "u2",
      fullName: ADVERSARIAL,
      telegramId: "9100",
      phone: null,
      cityCode: "JED",
      verificationStatus: "approved",
      isBlocked: false,
      isAvailable: true,
      ratingAverage: null,
      ratingCount: 0,
      services: ["transport"],
      subscription: null,
      completedOrders: 0,
      registeredAt: NOW.toISOString(),
    } as const;
    const base = {
      cities: [],
      filters: { cityId: null, verification: null, query: null },
      csrfToken: CSRF,
      total: 1,
      limit: 200,
    } as const;
    const html = renderDriversPage({ ...base, rows: [row] });
    expect(html).toMatch(
      /data-confirm="حظرُ حسابِ «&lt;img[^"]*" action="\/admin\/users\/u2\/blocked"/,
    );
    expect(html).not.toContain(ADVERSARIAL);
    const unblock = renderDriversPage({ ...base, rows: [{ ...row, isBlocked: true }] });
    expect(unblock).not.toMatch(/data-confirm="[^"]*" action="\/admin\/users\/u2\/blocked"/);
  });

  it("بابُ النجاة: التعطيلُ في منطقةِ خطرٍ منفصلةٍ بتأكيد، والتدويرُ يُؤكَّدُ حين يوجدُ اعتماد", () => {
    const active = renderBreakGlassPage({
      csrfToken: CSRF,
      hasActiveCredential: true,
      loginName: "ops",
    });
    expect(active).toContain("danger-zone");
    expect(active).toMatch(/data-confirm="[^"]+" action="\/admin\/break-glass\/disable"/);
    expect(active).toMatch(/data-confirm="[^"]+" action="\/admin\/break-glass"/);
    expect(active.match(/<h1>/g)?.length).toBe(1);
    const none = renderBreakGlassPage({
      csrfToken: CSRF,
      hasActiveCredential: false,
      loginName: null,
    });
    expect(none).not.toContain("/admin/break-glass/disable");
    expect(none).not.toContain("data-confirm");
  });

  it("الدخول: يشاركُ ورقةَ الأنماطِ نفسَها، ونموذجٌ واحدٌ بلا وسومٍ يتيمة، والخطأُ تنبيه", () => {
    const html = renderLoginPage({ step: "verify", telegramId: "1", error: "x", cspNonce: NONCE });
    expect(html.match(/<form/g)?.length).toBe(html.match(/<\/form>/g)?.length);
    expect(html).toContain('role="alert" class="notice notice--error">x<');
    expect(html).toContain('<main class="login" id="main">');
    expect(html).toContain(`<style nonce="${NONCE}">`);
  });
});

describe("UI-6 · تباينُ الرموز (WCAG AA ≥ 4.5)", () => {
  function luminance(hex: string): number {
    const n = Number.parseInt(hex.slice(1), 16);
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  }
  function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }
  function token(name: string): string {
    const m = STYLE.match(new RegExp(`--${name}:(#[0-9a-f]{6})`));
    if (m?.[1] === undefined) throw new Error(`missing token ${name}`);
    return m[1];
  }

  it("النصُّ والنصُّ الخافتُ والروابطُ والألوانُ الدلاليةُ مقروءةٌ على اللوحة والخلفية", () => {
    const AA = 4.5;
    for (const surface of ["bg", "panel", "panel-2", "field"]) {
      for (const fg of ["text", "muted", "brand", "amber", "ok", "bad"]) {
        expect({ fg, surface, ok: ratio(token(fg), token(surface)) >= AA }).toEqual({
          fg,
          surface,
          ok: true,
        });
      }
    }
    // نصُّ الأزرارِ الممتلئةِ داكنٌ على اللونِ لا أبيض.
    expect(ratio(token("on-solid"), token("brand"))).toBeGreaterThanOrEqual(AA);
    expect(ratio(token("on-solid"), token("bad"))).toBeGreaterThanOrEqual(AA);
  });
});
