/**
 * الغرض: الطبقةُ الرقيقةُ التي تنفّذ قرارَ التوجيه (البند `F1-05`): تقرأ الدورَ
 *   من الخادمِ، تسأل `routeForViewer` عن السطح، تحمّل حزمتَه، ثم تعرضه.
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: apps/miniapp/src/routing (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` وحدَه اليوم.
 * ملاحظات مستقبلية: شاشاتُ الحالاتِ الخمسِ `SS-01..SS-05` وحدودُ الأخطاءِ لكلِّ
 *   سطحٍ بندُ `F1-07`؛ فما ههنا نصوصُ حالةٍ صريحةٌ لا شاشاتُ نظامٍ مكتملة.
 *
 * **لا قرارَ صلاحيةٍ في هذا الملفِّ**: القرارُ في `routeForViewer` النقيّةِ فوقَ
 * ردِّ الخادمِ، وهذا الملفُّ أثرٌ جانبيٌّ (طلبُ شبكةٍ · تحميلُ حزمةٍ · عرض).
 * وعندَ أيِّ حالةٍ ليست سطحاً: **لا سطحَ يُعرَض** — لا سطحٌ افتراضيٌّ ولا أدنى.
 */

import { type ComponentType, useEffect, useState } from "react";
import { fetchViewer } from "../identity/viewer.ts";
import {
  loadSurface,
  type NoSurfaceReason,
  type RoleRoute,
  routeForViewer,
  type SurfaceLoaders,
} from "./role-route.ts";

interface SurfaceModule {
  readonly default: ComponentType;
}

/**
 * الاستيرادُ الديناميكيُّ هو ما يجعل حزمةَ السائقِ لا تُنزَّل لغيرِه فعلاً
 * (القسم 9.4)، لا تعليقٌ يقول ذلك.
 */
const SURFACE_LOADERS: SurfaceLoaders<SurfaceModule> = {
  rider: () => import("../surfaces/rider/RiderRoot.tsx"),
  driver: () => import("../surfaces/driver/DriverRoot.tsx"),
  admin: () => import("../surfaces/admin/AdminRoot.tsx"),
};

const REASON_TEXT: Readonly<Record<NoSurfaceReason, string>> = {
  unregistered: "لا حساب لك بعد. سجّل من بوت وَصْلة ثم أعد فتح التطبيق.",
  blocked: "هذا الحساب محجوب. راجع الدعم.",
  no_surface_yet: "لا توجد شاشة لدورك في التطبيق بعد.",
  session_invalid: "الجلسة غير صالحة. أعد فتح التطبيق من البوت.",
  session_expired: "انتهت الجلسة. أعد فتح التطبيق من البوت.",
  unavailable: "تعذّر تحديد دورك الآن. حاول لاحقاً.",
};

type RouterState =
  | { readonly kind: "resolving" }
  | { readonly kind: "surface"; readonly Component: ComponentType }
  | { readonly kind: "surface_failed" }
  | { readonly kind: "no_surface"; readonly reason: NoSurfaceReason };

export function RoleRouter() {
  const [state, setState] = useState<RouterState>({ kind: "resolving" });

  useEffect(() => {
    let active = true;
    void (async () => {
      const view = await fetchViewer();
      const route: RoleRoute = routeForViewer(view);
      if (route.surface === "none") {
        if (active) setState({ kind: "no_surface", reason: route.reason });
        return;
      }
      const outcome = await loadSurface(route, SURFACE_LOADERS);
      if (!active) return;
      if (outcome.loaded === "none" || "failed" in outcome) {
        setState({ kind: "surface_failed" });
        return;
      }
      setState({ kind: "surface", Component: outcome.module.default });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "resolving") {
    return (
      <p style={hint} aria-busy="true">
        جارٍ تحديد الدور…
      </p>
    );
  }
  if (state.kind === "surface_failed") {
    return <p style={hint}>تعذّر تحميل الشاشة. حاول لاحقاً.</p>;
  }
  if (state.kind === "no_surface") {
    return <p style={hint}>{REASON_TEXT[state.reason]}</p>;
  }

  const { Component } = state;
  return <Component />;
}

const hint: React.CSSProperties = { margin: 0, color: "var(--tg-hint-color)" };
