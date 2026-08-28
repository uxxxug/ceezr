/**
 * الغرض: هيكلُ التطبيق (القسم 9.4 حزمة `shell`) — يقيم الجلسةَ عندَ الإقلاعِ ثم
 *   يسلّم الشاشةَ إلى الموجّه، ويعرض شاشةَ الحالةِ المناسبةَ عندَ تعذّرِ ذلك.
 * الحالة: منفّذ فعلياً — البنود `F1-01` · `F1-05` · `F1-06` · `F1-07`.
 * ينتمي إلى: apps/miniapp/src/shell
 * يُتوقع أن يستخدمه لاحقاً: `App.tsx` وحدَه.
 * ملاحظات مستقبلية: `F1-08` جعل القياسَ **يُمرَّر** إلى الهيكلِ لا يُنشَأ فيه؛
 *   ومَن يُنشئه هو `App.tsx`. ودفعُ الأحداثِ إلى منصةِ قياسٍ ما زال غيرَ مقرَّرٍ.
 *
 * `F1-05`: الدورُ يُقرأ من الخادمِ في الموجّهِ لا من حاملِ الجلسةِ ولا من تيليجرام.
 *
 * `F1-06`: الإقلاعُ يضبط الاتجاهَ ثم يربط السمةَ **قبلَ** إعلامِ تيليجرامَ
 * بالجهوزية، فلا تُعرَض الشاشةُ بلونٍ ثم تُصحَّح. والربطُ يُفَكُّ عندَ التفكيك.
 *
 * `F1-07` — **وصلُ مسارِ الإقلاعِ كاملاً**: كان الهيكلُ يقف عندَ «بانتظارِ
 * التحقّقِ من الهوية» ولا ينادي شيئاً، فكانت الجلسةُ لا تُقام أبداً في الإنتاجِ
 * مهما صحَّ ما تحتَها. صار الآن ينادي `establishSession` (تجديدٌ من التخزينِ
 * الآمنِ، وإلّا مبادلةُ `initData`)، ويعرض عندَ الفشلِ شاشةَ حالةٍ مصنَّفةً لا
 * جملةً واحدةً لكلِّ الأسباب.
 *
 * و`SS-05` — «إعادةُ مصادقةٍ **بلا فقدانِ مسارِ العمل**» (9.7): إعادةُ المصادقةِ
 * ههنا تعيد إقامةَ الجلسةِ وحدَها ثم تُعيد تركيبَ الموجّهِ بمفتاحٍ جديدٍ. ولا
 * يُعاد تحميلُ الصفحةِ ولا يُطلَب من المستخدمِ أن يعيد فتحَ التطبيقِ من البوت:
 * وذاك هو عدمُ فقدانِ المسارِ بحدودِ ما في التطبيقِ اليومَ من مسارٍ — **وحدٌّ
 * معلَنٌ**: لا يوجد اليومَ مسارٌ متعدّدُ الخطواتِ ولا استمارةٌ نصفُ مملوءةٍ
 * يُختبَر بها حفظُ الموضعِ فعلاً؛ فما هو مُثبَتٌ أنّ الجلسةَ تُستأنَف بلا إعادةِ
 * تحميلٍ، لا أنّ حالةَ شاشةٍ عميقةٍ نجت.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { type BootFailureReason, establishSession } from "../identity/boot.ts";
import { clearSession } from "../identity/session.ts";
import { RoleRouter } from "../routing/RoleRouter.tsx";
import { applyDocumentDirection } from "../styles/direction.ts";
import { classifyFailure, failureFromThrown } from "../system/failure.ts";
import { deviceOnline, probeReachability } from "../system/health.ts";
import { Skeleton } from "../system/Skeleton.tsx";
import { SystemScreen } from "../system/SystemScreen.tsx";
import type { ScreenState } from "../system/state-text.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import { bindTelegramTheme, expandApp, notifyReady } from "../tg/index.ts";
import { Layout } from "./Layout.tsx";

type BootState =
  | { readonly kind: "booting" }
  | { readonly kind: "ready" }
  | { readonly kind: "screen"; readonly screen: ScreenState };

/** ترجمةُ سببِ فشلِ الإقلاعِ إلى شاشة — والتعطيلُ وحدَه يحتاج تشخيصاً. */
async function screenForBootFailure(
  reason: BootFailureReason,
  thrown: unknown,
): Promise<ScreenState> {
  if (reason === "OUTSIDE_TELEGRAM") return { kind: "outside_telegram" };
  if (reason === "MISSING_INIT_DATA") return { kind: "missing_init_data" };
  if (reason === "REJECTED") return { kind: "session_invalid" };

  const online = deviceOnline();
  // فشلٌ بلا استثناءٍ محمولٍ (تعطُّلٌ في التجديدِ) يُعامَل فشلَ نقلٍ: أضعفُ ما
  // يمكن ادّعاؤه، والفحصُ الواحدُ هو الذي يرفعه إلى تشخيصٍ إن أجاب.
  const failure = failureFromThrown(thrown) ?? ({ transport: "failed" } as const);
  const probe = failure.transport === "failed" && online ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online) ?? { kind: "unknown_error" };
}

export function Shell({ telemetry }: { readonly telemetry?: Telemetry } = {}) {
  const [boot, setBoot] = useState<BootState>({ kind: "booting" });
  /**
   * مفتاحُ الجلسة: يتغيّر عندَ كلِّ إعادةِ مصادقةٍ ناجحةٍ فيُعاد تركيبُ الموجّهِ
   * ويُعاد قراءةُ الدور. وهو أصدقُ من إعادةِ تحميلِ الصفحة: تلك تفقد كلَّ شيء.
   */
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => {
    applyDocumentDirection();
    const detachTheme = bindTelegramTheme();
    notifyReady();
    expandApp();
    return detachTheme;
  }, []);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * `discard` = اطرح ما في الذاكرةِ أوّلاً. لازمٌ لإعادةِ المصادقة: الخادمُ قد
   * يرفض رمزاً لم تنتهِ مدّتُه بعدُ في ساعةِ الجهازِ، فلو لم يُطرَح لعادت
   * `establishSession` بـ«جلسةٌ قائمة» ولدارَ المستخدمُ على الشاشةِ نفسِها.
   */
  const runBoot = useCallback(
    async (discard = false) => {
      if (discard) clearSession();
      setBoot({ kind: "booting" });
      // `F1-08`: القياسُ يُمرَّر ولا يُنشَأ ههنا — والهيكلُ لا يعرف مَصرِفاً.
      const result = await establishSession(telemetry === undefined ? {} : { telemetry });
      if (!mounted.current) return;
      if (result.established) {
        setBoot({ kind: "ready" });
        setSessionEpoch((value) => value + 1);
        return;
      }
      const screen = await screenForBootFailure(result.reason, result.thrown);
      if (mounted.current) setBoot({ kind: "screen", screen });
    },
    [telemetry],
  );

  useEffect(() => {
    void runBoot();
  }, [runBoot]);

  if (boot.kind === "booting") {
    return (
      <Layout busy>
        <Skeleton />
      </Layout>
    );
  }

  if (boot.kind === "screen") {
    return (
      <Layout>
        <SystemScreen state={boot.screen} onAction={() => void runBoot(true)} />
      </Layout>
    );
  }

  return (
    <Layout>
      <RoleRouter key={sessionEpoch} onReauth={() => void runBoot(true)} />
    </Layout>
  );
}
