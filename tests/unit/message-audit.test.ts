/**
 * الغرض: `MSG-AUDIT-01` · `MSG-COLOR-01` — تصحيحاتُ نصوصِ تيليجرام التي كشفَها معرضُ الرسائلِ:
 *   العددُ والمعدودُ، وتلميحُ الردِّ في بطاقةِ الدعمِ، وسطرُ الاشتراكِ المترجَمُ، وتلميحُ الإلغاءِ
 *   في وضعِ التطبيقِ، وعلامةُ لونِ الخدمةِ على البطاقاتِ.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { describe, expect, it } from "bun:test";
import { buildMessageGallery } from "../../apps/gateway/src/admin/message-gallery.ts";
import { countedPhrase, t } from "../../packages/shared/i18n/index.ts";
import { serviceMarker } from "../../packages/shared/service-marker/index.ts";

const FORMS = "يوم واحد|يومان|أيام|يوماً";

describe("العدد والمعدود", () => {
  it("يختار المعدود بالعدد", () => {
    expect(countedPhrase(1, FORMS)).toBe("يوم واحد");
    expect(countedPhrase(2, FORMS)).toBe("يومان");
    expect(countedPhrase(3, FORMS)).toBe("3 أيام");
    expect(countedPhrase(10, FORMS)).toBe("10 أيام");
    expect(countedPhrase(11, FORMS)).toBe("11 يوماً");
    expect(countedPhrase(29, FORMS)).toBe("29 يوماً");
    expect(countedPhrase(103, FORMS)).toBe("103 أيام");
  });

  it("صيغة ناقصة أو قيمة غير عددية لا تختلق معدوداً", () => {
    expect(countedPhrase(3, "يوم|أيام")).toBeNull();
    expect(countedPhrase(Number.NaN, FORMS)).toBeNull();
  });

  it("تنبيه الاشتراك لا يقول «3 يوماً» بعد اليوم", () => {
    const text = t("ar")("subscription.expiring_soon", { days: 3, date: "2026-11-03" });
    expect(text).toContain("3 أيام");
    expect(text).not.toContain("يوماً");
  });

  it("الإنجليزية لا تتأثّر", () => {
    expect(t("en")("subscription.expiring_soon", { days: 3, date: "x" })).toContain("3");
  });
});

describe("علامة لون الخدمة", () => {
  it("أصفر للتوصيل وأخضر للمشوار", () => {
    expect(serviceMarker("delivery").startsWith("🟨")).toBe(true);
    expect(serviceMarker("transport").startsWith("🟩")).toBe(true);
    expect(serviceMarker(null)).toBe("🚕");
  });
});

describe("النصوص المصحّحة كما تُرسَل", () => {
  it("بطاقات العروض والقروب تحمل اللون، والدعم يملأ رقم التذكرة ويترجم الاشتراك", async () => {
    const gallery = await buildMessageGallery({ miniAppUrl: "https://miniapp.example" });
    const byId = (id: string) => gallery.find((s) => s.id === id)?.text ?? "";
    expect(byId("driver-offer-delivery").startsWith("🟨")).toBe(true);
    expect(byId("driver-offer-transport").startsWith("🟩")).toBe(true);
    expect(byId("group-unsub-delivery").startsWith("🟨")).toBe(true);
    expect(byId("group-unsub-transport").startsWith("🟩")).toBe(true);

    const support = byId("support-subscription");
    expect(support).not.toContain("{ticket_short}");
    expect(support).toContain("/answer 00000000");
    expect(support).not.toContain("both — active");

    expect(byId("driver-cancelled-assigned")).not.toContain("أُلغى");
    expect(byId("rider-nodriver-transport")).not.toContain("القائمة أسفل الشاشة");
    expect(byId("rider-nodriver-transport")).toContain("تطبيق وَصْلة");
    expect(byId("driver-lost-item")).not.toContain("بالردِّ على هذه الرسالة");
  });

  it("في وضع المحادثة يبقى تلميح زرّ القائمة", async () => {
    const gallery = await buildMessageGallery({ miniAppUrl: null });
    const text = gallery.find((s) => s.id === "rider-nodriver-transport")?.text ?? "";
    expect(text).toContain("«❌ إلغاء طلبي»");
  });
});
