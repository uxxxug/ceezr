/**
 * الغرض: إثباتُ أنّ حارسَ مرجعيةِ الدور (`F1-05`) **يمسك الخرقَ فعلاً** ولا
 *   يكتفي بالمرورِ على الشيفرةِ الصحيحة: خرقٌ مُصنَّعٌ لكلِّ قاعدةٍ يُرفَع، وشيفرةٌ
 *   سليمةٌ لا تُرفَع، والتعليقاتُ التي تذكر الأنماطَ نصّاً لا تُحتسَب.
 * الحالة: اختبار فعلي — يستدعي دالّةَ الفحصِ مباشرةً بلا كتابةِ ملفّات.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديلٍ على scripts/check-viewer-role-authority.ts
 * ملاحظات مستقبلية: القواعدُ تُختبَر آلةً لا قائمةً: إضافةُ قاعدةٍ جديدةٍ تحتاج
 *   حالتَها الموجبةَ والسالبةَ ههنا.
 *
 * وحارسٌ لا يُختبَر سالباً حارسٌ مُدَّعىً: قد يمرُّ لأنّ نمطَه لا يطابق شيئاً
 * أبداً، فيُقرأ خُضرةُ CI أماناً وهي صمتٌ.
 */

import { describe, expect, it } from "bun:test";
import { blankComments, findViolations, RULES } from "../../scripts/check-viewer-role-authority.ts";

const MINIAPP = "apps/miniapp/src/surfaces/rider/RiderRoot.tsx";
const VIEWER = "apps/miniapp/src/identity/viewer.ts";
const ROUTE = "apps/gateway/src/routes/some-route.ts";
const ME_ROUTE = "apps/gateway/src/routes/me.ts";

const ids = (file: string, source: string): string[] =>
  findViolations(file, source).map((violation) => violation.rule);

describe("حارسُ مرجعيةِ الدور: يمسك الخرق", () => {
  it("١) تخزينُ الدورِ على الجهازِ يُرفَع", () => {
    expect(ids(MINIAPP, 'secureStorageSet("role", role);\n')).toContain("role-not-persisted");
    expect(ids(MINIAPP, 'localStorage.setItem("waslah-role", role);\n')).toContain(
      "role-not-persisted",
    );
  });

  it("٢) استنتاجُ الدورِ من تيليجرام يُرفَع", () => {
    // يُركَّب المُعرَّفُ في وقتِ التشغيلِ لا نصّاً: حاجزُ عزلِ طبقةِ تيليجرام (F1-02 ·
    // ADR 0031) يمنع ذكرَه حرفياً خارجَ الطبقةِ — ولو في خرقٍ مُصنَّعٍ لاختبارِ حاجزٍ آخر.
    const unsafeIdentifier = ["initData", "Unsafe"].join("");
    expect(ids(MINIAPP, `const role = ${unsafeIdentifier}.user.role;\n`)).toContain(
      "role-not-from-telegram",
    );
  });

  it("٣) قراءةُ مسارِ الدورِ من موضعٍ ثانٍ تُرفَع", () => {
    expect(ids(MINIAPP, 'const me = await apiFetch("/v1/me");\n')).toContain(
      "me-read-in-one-place",
    );
  });

  it("٤) دورٌ افتراضيٌّ عندَ الشكِّ يُرفَع", () => {
    expect(ids(MINIAPP, 'const role = server.role ?? "rider";\n')).toContain("no-default-role");
    expect(ids(MINIAPP, 'const role = server.role || "admin";\n')).toContain("no-default-role");
  });

  it("٥) قبولُ الدورِ من الطلبِ في البوابةِ يُرفَع", () => {
    expect(ids(ROUTE, "const role = body.role;\n")).toContain("no-role-from-request");
    expect(ids(ROUTE, 'const role = c.req.header("x-role");\n')).toContain("no-role-from-request");
    expect(ids(ROUTE, 'const role = c.req.query("role");\n')).toContain("no-role-from-request");
  });

  it("٦) تسميةُ دورٍ في كودِ مسارِ الدورِ تُرفَع", () => {
    expect(ids(ME_ROUTE, 'if (viewer.role === "admin") return c.json({ ok: true });\n')).toContain(
      "me-route-names-no-role",
    );
  });
});

describe("حارسُ مرجعيةِ الدور: لا إنذارَ كاذباً", () => {
  it("٧) موضعُ القراءةِ الوحيدُ لا يُرفَع عليه مسارُ الدور", () => {
    expect(ids(VIEWER, 'const payload = await apiFetch("/v1/me");\n')).toEqual([]);
  });

  it("٨) تعليقٌ يذكر النمطَ نصّاً لا يُحتسَب خرقاً", () => {
    const source = [
      "/**",
      ' * ممنوع: localStorage.setItem("role", role) — الدورُ من الخادم.',
      " */",
      "const surface = routeForViewer(view);",
      "",
    ].join("\n");
    expect(ids(MINIAPP, source)).toEqual([]);
  });

  it('٩) تعليقٌ سطريٌّ يذكر `?? "rider"` لا يُحتسَب خرقاً', () => {
    expect(ids(MINIAPP, '// لا يجوز: const r = x ?? "rider";\nconst y = 1;\n')).toEqual([]);
  });

  it("١٠) قراءةُ الدورِ من نتيجةِ الخادمِ في مسارٍ عاديٍّ لا تُرفَع", () => {
    expect(ids(ROUTE, "return c.json({ ok: true, role: result.value.role });\n")).toEqual([]);
  });

  it("١١) شيفرةُ التوجيهِ التي تسمّي الأسطحَ لا تُرفَع خارجَ مسارِ الدور", () => {
    const source = 'if (view.role === "driver") return { surface: "driver" };\n';
    expect(ids("apps/miniapp/src/routing/role-route.ts", source)).toEqual([]);
  });

  it("١٢) ملفُّ اختبارٍ يستعمل مسارَ الدورِ لا يُرفَع عليه", () => {
    expect(ids("apps/miniapp/src/api/client.test.ts", 'await apiFetch("/v1/me");\n')).toEqual([]);
  });
});

describe("حارسُ مرجعيةِ الدور: الآلة", () => {
  it("١٣) تفريغُ التعليقاتِ يحفظ أرقامَ الأسطر", () => {
    const source = ["/* أ", "ب", "*/", 'const role = x ?? "rider";', ""].join("\n");
    const violations = findViolations(MINIAPP, source);
    expect(violations.map((violation) => violation.line)).toEqual([4]);
  });

  it("١٤) كودٌ يلي تعليقَ كتلةٍ أُغلق في السطرِ نفسِه لا يُخفى", () => {
    expect(ids(MINIAPP, '/* وصف */ const role = x ?? "admin";\n')).toContain("no-default-role");
  });

  it("١٥) لكلِّ قاعدةٍ معرّفٌ وسببٌ مكتوبٌ لا فراغ", () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const rule of RULES) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    }
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
  });

  it("١٦) التفريغُ يُبقي طولَ المصدرِ فلا تنزلق المطابقة", () => {
    const source = 'const a = 1; // role ?? "rider"\n';
    expect(blankComments(source).length).toBe(source.length);
  });
});
