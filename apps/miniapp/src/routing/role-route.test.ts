/**
 * الغرض: إثباتُ قاعدةِ التوجيهِ المبنيِّ على الدور (`F1-05`): سطحٌ واحدٌ لكلِّ
 *   دورٍ، ولا سطحَ عندَ الحجبِ أو غيابِ الجلسةِ أو التعذُّر، وأنّ **حزمةَ السائقِ
 *   لا تُطلَب لغيرِ السائق** (القسم 9.4)، وأنّ فشلَ تحميلِ حزمةٍ يُعلَن ولا يُبدَّل
 *   بسطحٍ آخر.
 * الحالة: اختبار فعلي — دالّةٌ نقيّةٌ ومُحمّلاتٌ مُصنَّعة؛ لا DOM ولا متصفّح.
 *   وتحميلُ الحزمِ الفعليُّ في متصفّحٍ حقيقيٍّ **غيرُ مُختبَرٍ ههنا ولا يُدَّعى**.
 * ينتمي إلى: apps/miniapp/src/routing
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يومَ يُبنى سطحُ `support` يتغيّر توقُّعُ حالتِه في هذا الملف
 *   — فيسقط الاختبارُ حتى يُقرَّر السطحُ صريحاً.
 */

import { describe, expect, it } from "bun:test";
import type { ViewerRole, ViewerView } from "../identity/viewer.ts";
import { loadSurface, routeForViewer, type SurfaceLoaders } from "./role-route.ts";

const active = (role: ViewerRole): ViewerView => ({ kind: "viewer", role, status: "active" });

describe("التوجيه: سطحٌ لكلِّ دور", () => {
  it("١) الراكبُ إلى سطحِ الراكب", () => {
    expect(routeForViewer(active("rider"))).toEqual({ surface: "rider" });
  });

  it("٢) السائقُ إلى سطحِ السائق", () => {
    expect(routeForViewer(active("driver"))).toEqual({ surface: "driver" });
  });

  it("٣) المشرفُ إلى سطحِ المشرف", () => {
    expect(routeForViewer(active("admin"))).toEqual({ surface: "admin" });
  });

  it("٤) `support` لا سطحَ له بعدُ — ولا يُطوى على راكبٍ ولا يُرقّى إلى مشرف", () => {
    expect(routeForViewer(active("support"))).toEqual({
      surface: "none",
      reason: "no_surface_yet",
    });
  });
});

describe("التوجيه: لا سطحَ عندَ الشك", () => {
  it("٥) «غير مسجَّل» لا سطحَ له بسببٍ صريح", () => {
    expect(routeForViewer({ kind: "viewer", role: "unknown", status: "unregistered" })).toEqual({
      surface: "none",
      reason: "unregistered",
    });
  });

  it("٦) محجوبٌ لا سطحَ له", () => {
    expect(routeForViewer({ kind: "blocked" })).toEqual({ surface: "none", reason: "blocked" });
  });

  it("٧) جلسةٌ منتهيةٌ وجلسةٌ باطلةٌ حالتان متمايزتان", () => {
    expect(routeForViewer({ kind: "session_expired" })).toEqual({
      surface: "none",
      reason: "session_expired",
    });
    expect(routeForViewer({ kind: "session_invalid" })).toEqual({
      surface: "none",
      reason: "session_invalid",
    });
  });

  it("٨) التعذُّرُ لا يفتح سطحاً افتراضياً", () => {
    expect(routeForViewer({ kind: "unavailable" })).toEqual({
      surface: "none",
      reason: "unavailable",
    });
  });

  it("٩) دورٌ نشِطٌ مع حالةِ «غير مسجَّل» لا يفتح سطحاً — الحالةُ تحسم", () => {
    expect(routeForViewer({ kind: "viewer", role: "admin", status: "unregistered" })).toEqual({
      surface: "none",
      reason: "unregistered",
    });
  });
});

interface LoaderSpy {
  readonly loaders: SurfaceLoaders<string>;
  readonly called: string[];
}

function spyLoaders(options: { failing?: string } = {}): LoaderSpy {
  const called: string[] = [];
  const make = (name: string) => async () => {
    called.push(name);
    if (options.failing === name) throw new Error("فشلُ تحميلٍ مُصنَّع");
    return `${name}-module`;
  };
  return {
    called,
    loaders: { rider: make("rider"), driver: make("driver"), admin: make("admin") },
  };
}

describe("تحميلُ الحزم: حزمةُ الدورِ وحدَها", () => {
  it("١٠) حزمةُ السائقِ لا تُطلَب للراكب", async () => {
    const spy = spyLoaders();
    const outcome = await loadSurface(routeForViewer(active("rider")), spy.loaders);

    expect(spy.called).toEqual(["rider"]);
    expect(outcome).toEqual({ loaded: "rider", module: "rider-module" });
  });

  it("١١) حزمةُ السائقِ تُطلَب للسائقِ وحدَه", async () => {
    const spy = spyLoaders();
    await loadSurface(routeForViewer(active("driver")), spy.loaders);
    expect(spy.called).toEqual(["driver"]);
  });

  it("١٢) حزمةُ المشرفِ للمشرفِ وحدَه", async () => {
    const spy = spyLoaders();
    await loadSurface(routeForViewer(active("admin")), spy.loaders);
    expect(spy.called).toEqual(["admin"]);
  });

  it("١٣) لا حزمةَ تُطلَب لمحجوبٍ ولا لغيرِ مسجَّلٍ ولا لجلسةٍ باطلة", async () => {
    for (const view of [
      { kind: "blocked" } as const,
      { kind: "session_invalid" } as const,
      { kind: "unavailable" } as const,
      { kind: "viewer", role: "unknown", status: "unregistered" } as const,
      { kind: "viewer", role: "support", status: "active" } as const,
    ]) {
      const spy = spyLoaders();
      const outcome = await loadSurface(routeForViewer(view), spy.loaders);
      expect(spy.called).toEqual([]);
      expect(outcome).toEqual({ loaded: "none" });
    }
  });

  it("١٤) فشلُ تحميلِ حزمةٍ يُعلَن فشلاً ولا يُبدَّل بسطحٍ آخر", async () => {
    const spy = spyLoaders({ failing: "driver" });
    const outcome = await loadSurface(routeForViewer(active("driver")), spy.loaders);

    expect(outcome).toEqual({ loaded: "driver", failed: true });
    expect(spy.called).toEqual(["driver"]);
  });

  it("١٥) القرارُ حتميٌّ: مدخلٌ واحدٌ يعطي السطحَ نفسَه في كلِّ نداء", () => {
    expect(routeForViewer(active("driver"))).toEqual(routeForViewer(active("driver")));
    expect(routeForViewer({ kind: "blocked" })).toEqual(routeForViewer({ kind: "blocked" }));
  });
});
