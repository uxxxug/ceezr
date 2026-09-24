/**
 * الغرض: الطبقةُ الرقيقةُ التي تنفّذ قرارَ التوجيه (البند `F1-05`): تقرأ الدورَ
 *   من الخادمِ، تسأل `routeForViewer` عن السطح، تحمّل حزمتَه، ثم تعرضه. وفي
 *   `F1-07`: تعرض هيكلَ التحميلِ وشاشاتِ الحالاتِ وتلفّ السطحَ بحدِّ خطأٍ خاصٍّ به.
 * الحالة: منفّذ فعلياً — البند `F1-05`، ومُوسَّعٌ في `F1-07`.
 * ينتمي إلى: apps/miniapp/src/routing (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` وحدَه اليوم.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ (القسم 9.3) بندُ `F2`/`F3`.
 *
 * **لا قرارَ صلاحيةٍ في هذا الملفِّ**: القرارُ في `routeForViewer` النقيّةِ فوقَ
 * ردِّ الخادمِ، وهذا الملفُّ أثرٌ جانبيٌّ (طلبُ شبكةٍ · تحميلُ حزمةٍ · عرض).
 * وعندَ أيِّ حالةٍ ليست سطحاً: **لا سطحَ يُعرَض** — لا سطحٌ افتراضيٌّ ولا أدنى.
 *
 * `F1-07` — ثلاثُ إضافاتٍ وحدودُها:
 *   ــ **حدُّ خطأٍ لكلِّ سطح**: سقوطُ سطحِ السائقِ لا يُبيّض التطبيقَ كلَّه، ولا
 *      يُسقِط الإطارَ. والحدُّ الجذريُّ في `App.tsx` يبقى للسقوطِ فوقَ ذلك.
 *   ــ **إعادةُ المحاولةِ بيدِ المستخدمِ وحدَه**: عدّادُ `attempt` يعيد تشغيلَ
 *      الأثرِ عندَ الضغط. ولا مؤقّتَ ولا استقصاءَ دوريّاً (ADR 0035 §4)، ويحرس
 *      ذلك فحصٌ في CI لا اتفاقٌ يُنسى.
 *   ــ **تشخيصُ التعطيلِ بفحصٍ واحدٍ**: عندَ فشلِ نقلٍ يُنادى `GET /health` مرّةً
 *      لتمييزِ «شبكتُك» من «خدمتُنا» (9.7)، ولا يُنادى في غيرِ هذه الحال.
 *
 * وحدٌّ معلَنٌ: إعادةُ المصادقةِ في `SS-05` ليست ههنا — موضعُها الإقلاعُ في
 * `Shell` لأنّ الجلسةَ فوقَ الموجّهِ لا داخلَه، ويُرفَع الطلبُ إليه بـ`onReauth`.
 *
 * `F1-09`: `fetchViewer` صار خاصّيةً إلزاميّةً لا استيراداً — السببُ في
 * `shell/identity-port.ts` وADR 0044.
 */

import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
} from "../../../../packages/shared/i18n/miniapp/index.ts";
import type { ViewerView } from "../identity/viewer.ts";
import { ErrorBoundary } from "../shell/ErrorBoundary.tsx";
import {
  classifyFailure,
  type ReachabilityProbe,
  shouldProbeReachability,
} from "../system/failure.ts";
import { deviceOnline, probeReachability } from "../system/health.ts";
import { Skeleton } from "../system/Skeleton.tsx";
import { SystemScreen } from "../system/SystemScreen.tsx";
import type { ScreenState } from "../system/state-text.ts";
import {
  loadSurface,
  type NoSurfaceReason,
  type RoleRoute,
  routeForViewer,
  type SurfaceLoaders,
} from "./role-route.ts";

interface SurfaceModule {
  readonly default: ComponentType<LanguageSurfaceProps>;
}

export interface LanguageSurfaceProps {
  /** لغةُ الواجهةِ من الحسابِ (`PD-030`) — تُحقَنُ من الموجّهِ الذي قرأَها من الخادمِ. */
  readonly language: MiniAppLanguage;
  /**
   * تُنادى حينَ يُغيِّرُ المستخدمُ لغتَه من الإعداداتِ — ليُحدِّثَ الموجّهُ حالتَه
   * فينعكسَ التغييرُ على كلِّ السطحِ فوراً.
   */
  readonly onLanguageChanged?: (language: MiniAppLanguage) => void;
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

type RouterState =
  | { readonly kind: "resolving" }
  | { readonly kind: "surface"; readonly Component: ComponentType<LanguageSurfaceProps> }
  | { readonly kind: "screen"; readonly screen: ScreenState };

export interface RoleRouterProps {
  /**
   * `F1-09`: قراءةُ الدورِ **تُحقَن**. والموجّهُ في حزمةِ `shell` و`fetchViewer` في
   * حزمةِ `identity` (9.4)، فاستيرادُها ههنا كان يُنتِج دائرةً بين الحزمتَين في
   * البناء. والحاقنُ اليومَ هو `Shell` عن بابِ الهويةِ الذي يستقبله.
   */
  readonly fetchViewer: () => Promise<ViewerView>;
  /**
   * يُنادى حين تكون الجلسةُ هي العطلَ — فالموجّهُ لا يملك مصادقةً ولا يدّعيها.
   * وغيابُه يعني عرضَ الشاشةِ بلا فعلٍ بدلَ زرٍّ لا يفعل شيئاً (`UX-8`).
   */
  readonly onReauth?: () => void;
}

/**
 * تحويلُ سببِ «لا سطحَ» إلى شاشةٍ. وحالةُ `unavailable` وحدَها تحتاج تصنيفاً:
 * سائرُ الأسبابِ قراراتُ تفويضٍ صريحةٌ من الخادمِ لها نصٌّ واحدٌ لا يحتمل تشخيصاً.
 */
async function screenForReason(reason: NoSurfaceReason, view: ViewerView): Promise<ScreenState> {
  if (reason !== "unavailable") return { kind: reason };
  const failure = view.kind === "unavailable" ? view.failure : undefined;
  if (failure === undefined) return { kind: "unknown_error" };

  const online = deviceOnline();
  let probe: ReachabilityProbe = "not_probed";
  if (shouldProbeReachability(failure, online)) probe = await probeReachability();
  return classifyFailure(failure, probe, online) ?? { kind: "unknown_error" };
}

export function RoleRouter({ fetchViewer, onReauth }: RoleRouterProps) {
  const [state, setState] = useState<RouterState>({ kind: "resolving" });
  const [language, setLanguage] = useState<MiniAppLanguage>(MINIAPP_DEFAULT_LANGUAGE);
  const mounted = useRef(true);
  /**
   * `F1-09` الصفُّ ٥ — علامةُ «وقتِ التفاعلِ»: تُوضَعُ مرّةً واحدةً حينَ يَنتقلُ
   * الموجّهُ من «حلٍّ» إلى أيِّ حالةٍ أخرى (سطحٌ أو شاشةُ)، أي حينَ يصيرُ التطبيقُ
   * قابلاً للتفاعلِ بعدَ الإقلاعِ الكاملِ (تبادلُ الجلسةِ + قراءةُ الدورِ + تحميلُ
   * السطحِ). والعلامةُ بلا كلفةٍ (`performance.mark` لا يُغيّرُ سلوكاً) وتُقرأُ من
   * `scripts/measure-tti.ts`.
   */
  const interactiveMarked = useRef(false);
  useEffect(() => {
    if (!interactiveMarked.current && state.kind !== "resolving") {
      interactiveMarked.current = true;
      if (typeof performance !== "undefined" && typeof performance.mark === "function") {
        performance.mark("waslah-interactive");
      }
    }
  }, [state.kind]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * محاولةٌ واحدةٌ كاملة. تُنادى مرّةً عندَ التركيبِ ومرّةً كلَّما ضغط المستخدمُ
   * «إعادةَ المحاولة» — **ولا يناديها مؤقّتٌ ولا مستمعٌ دوريّ** (ADR 0035 §4).
   */
  const resolve = useCallback(async () => {
    setState({ kind: "resolving" });
    const view = await fetchViewer();
    // `PD-030`: لغةُ الواجهةِ تُقرأُ من الحسابِ لا تُفترَضُ. وغيابُها أو بطلانُها
    // يعني أنَّ الردَّ ناقصٌ فلا يُكملُ — `fetchViewer` يُعيدُ `unavailable` حينَها.
    if (view.kind === "viewer" && mounted.current) setLanguage(view.languageCode);
    const route: RoleRoute = routeForViewer(view);
    if (route.surface === "none") {
      const screen = await screenForReason(route.reason, view);
      if (mounted.current) setState({ kind: "screen", screen });
      return;
    }
    const outcome = await loadSurface(route, SURFACE_LOADERS);
    if (!mounted.current) return;
    if (outcome.loaded === "none" || "failed" in outcome) {
      setState({ kind: "screen", screen: { kind: "surface_failed" } });
      return;
    }
    setState({ kind: "surface", Component: outcome.module.default });
  }, [fetchViewer]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const retry = () => void resolve();

  if (state.kind === "resolving") return <Skeleton />;

  if (state.kind === "screen") {
    const needsSession =
      state.screen.kind === "session_expired" || state.screen.kind === "session_invalid";
    // شاشةُ الجلسةِ بلا مُصادِقٍ فوقَها تُعرَض بلا زرّ: زرٌّ لا يؤدّي إلى مصادقةٍ
    // أسوأُ من لا زرٍّ. وسائرُ الشاشاتِ فعلُها إعادةُ القراءة.
    const action = needsSession ? onReauth : retry;
    // الحذفُ لا التمريرُ بـ`undefined`: `exactOptionalPropertyTypes` مفعَّلٌ،
    // وغيابُ الفعلِ هو ما يجعل الزرَّ لا يُرسَم أصلاً.
    return action === undefined ? (
      <SystemScreen state={state.screen} />
    ) : (
      <SystemScreen state={state.screen} onAction={action} />
    );
  }

  const { Component } = state;
  return (
    <ErrorBoundary label="surface" onReset={retry}>
      <Component language={language} onLanguageChanged={setLanguage} />
    </ErrorBoundary>
  );
}
