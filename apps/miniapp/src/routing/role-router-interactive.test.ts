/**
 * الغرض: إثباتُ أنّ علامةَ `waslah-interactive` (البند `D-26` · F1-09 الصفُّ ٥)
 *   لا تُطلَقُ إلا حينَ يصلُ الموجّهُ إلى **سطحٍ منتجٍ فعليٍّ** (`rider`/`driver`/
 *   `admin`) — لا على أيِّ انتقالٍ من `resolving`، بما في ذلك شاشاتٌ نظاميّةٌ
 *   مثل `unregistered`/`blocked`/`no_surface_yet`/`surface_failed` وغيرها.
 * الحالة: اختبارٌ توضيحيٌّ (regression) — أُضيفَ بعدَ اكتشافِ إيجابٍ كاذبٍ:
 *   `measure-tti.ts` لم يكن يبذرُ مستخدمَ الاختبارِ، فكانَ `/v1/me` يُعيدُ
 *   `unregistered` ← `route.surface === "none"` ← الموجّهُ يعرضُ شاشةً نظاميّةً
 *   لا سطحاً، وكانت العلامةُ التفاعليّةُ تُطلَقُ رغم ذلك لأنّها كانت مربوطةً
 *   بـ`state.kind !== "resolving"` لا بـ`state.kind === "surface"`.
 * ينتمي إلى: apps/miniapp/src/routing
 * يُتوقع أن يستخدمه لاحقاً: CI (browser-tti) — دليلٌ على أنّ الإصلاحَ ثابتٌ.
 *
 * ═══ حدٌّ معلَنٌ ═══
 * `interactiveSurfaceFromState` دالّةٌ صافيةٌ استُخرِجَت خصّيصاً من `RoleRouter`
 * لتُختبَر بلا DOM ولا `useEffect` ولا متصفّح — المستودعُ لا يملكُ بيئةَ DOM
 * (انظر `system/screens.test.tsx`). هذا يُثبتُ **منطقَ القرارِ** الذي يقرّرُ
 * متى تُطلَقُ العلامةُ؛ إطلاقَها الفعليَّ في متصفّحٍ حقيقيٍّ يُثبتُه `measure-tti.ts`
 * وحَكَمُ `interactive-budget.ts` (`NO_SURFACE` · `INTERACTIVE_WITHOUT_SURFACE`).
 */

import { describe, expect, it } from "bun:test";
import type { ComponentType } from "react";
import type { ScreenState } from "../system/state-text.ts";
import type { LanguageSurfaceProps } from "./RoleRouter.tsx";
import { interactiveSurfaceFromState } from "./RoleRouter.tsx";

// مكوّنٌ وهميٌّ لا يُستدعى — النوعُ فقط هو المطلوبُ ههنا.
const DummySurface = (() => null) as unknown as ComponentType<LanguageSurfaceProps>;

describe("D-26: مصدرُ قرارِ العلامةِ التفاعليّةِ لا يُطلِقُها إلا على سطحٍ منتج", () => {
  it("١) resolving ⇒ لا سطحَ (null) — لم يُحسَم الأمرُ بعد", () => {
    expect(interactiveSurfaceFromState({ kind: "resolving" })).toBeNull();
  });

  it("٢) سطحٌ منتجٌ (rider) ⇒ اسمُ السطحِ يُعاد كما هو", () => {
    expect(
      interactiveSurfaceFromState({ kind: "surface", Component: DummySurface, surface: "rider" }),
    ).toBe("rider");
  });

  it("٣) سطحٌ منتجٌ (driver) ⇒ اسمُ السطحِ يُعاد كما هو", () => {
    expect(
      interactiveSurfaceFromState({ kind: "surface", Component: DummySurface, surface: "driver" }),
    ).toBe("driver");
  });

  it("٤) سطحٌ منتجٌ (admin) ⇒ اسمُ السطحِ يُعاد كما هو", () => {
    expect(
      interactiveSurfaceFromState({ kind: "surface", Component: DummySurface, surface: "admin" }),
    ).toBe("admin");
  });

  // هذا هو مسارُ الإيجابِ الكاذبِ نفسُه الذي وقعَ فعلياً في CI: `/v1/me` يُعيدُ
  // `unregistered` لعدمِ بذرِ المستخدمِ، فيصلُ الموجّهُ إلى شاشةٍ نظاميّةٍ لا سطحاً.
  const SYSTEM_SCREENS: readonly ScreenState[] = [
    { kind: "unregistered" },
    { kind: "blocked" },
    { kind: "no_surface_yet" },
    { kind: "surface_failed" },
    { kind: "session_invalid" },
    { kind: "session_expired" },
    { kind: "unknown_error" },
    { kind: "service_unavailable", retryAfterSeconds: 30 },
    { kind: "no_connection", cause: "device_offline" },
    { kind: "no_connection", cause: "service_unreachable" },
    { kind: "missing_init_data" },
    { kind: "unsupported_city" },
  ];

  for (const screen of SYSTEM_SCREENS) {
    it(`٥) شاشةٌ نظاميّةٌ (${screen.kind}) ⇒ لا سطحَ (null) — لا علامةَ تفاعليّةً`, () => {
      expect(interactiveSurfaceFromState({ kind: "screen", screen })).toBeNull();
    });
  }
});
